import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { RagConfig } from './rag.config';
import {
  TranscriptLine,
  ContextualChunk,
  DenseSummaryResult,
} from './rag.types';

/**
 * RAG Summary Service
 *
 * LLM을 활용한 고밀도 상세 요약 생성 및 문맥 헤더 주입
 *
 * 핵심 기능:
 * 1. 원본 대화의 대명사를 구체적 명사로 치환
 * 2. 고유명사(약 이름, 가족 이름), 수치, 감정 상태 100% 보존
 * 3. STT 노이즈 제거 및 횡설수설 정제
 * 4. 150-200자 단위 청킹 + [날짜 | 주제 | 키워드] 헤더 주입
 *
 * 최적화:
 * - 단일 LLM 호출로 요약본 + 청크 배열 동시 생성 (비용/시간 절감)
 */
@Injectable()
export class RagSummaryService implements OnModuleInit {
  private readonly logger = new Logger(RagSummaryService.name);
  private bedrockClient: BedrockRuntimeClient | null = null;

  constructor(private readonly config: RagConfig) {}

  async onModuleInit() {
    const awsRegion = process.env.AWS_REGION || 'ap-northeast-2';

    this.bedrockClient = new BedrockRuntimeClient({
      region: awsRegion,
    });

    this.logger.log(
      `Summary service initialized: ${this.config.summaryModel} (chunk size: ${this.config.contextualChunkSize}-${this.config.contextualChunkMax}, timeout: ${this.config.summaryRequestTimeoutMs}ms)`,
    );
  }

  /**
   * 원본 대화를 상세 요약하고 문맥 헤더가 포함된 청크 배열 생성
   *
   * @param transcripts 원본 스크립트 배열
   * @param callDate 통화 날짜 (YYYY-MM-DD 형식)
   * @returns 요약본 + 청크 배열 + 메타데이터
   */
  async generateDenseSummaryWithChunks(
    transcripts: TranscriptLine[],
    callDate: string,
  ): Promise<DenseSummaryResult> {
    if (!transcripts || transcripts.length === 0) {
      return this.createEmptyResult();
    }

    const originalText = this.formatTranscripts(transcripts);
    const originalLength = originalText.length;

    this.debug(
      `Starting dense summary: ${originalLength} chars, date=${callDate}`,
    );

    // Token Limit 체크: 너무 긴 대화는 분할 처리
    if (originalLength > this.config.maxInputChars) {
      this.logger.warn(
        `Input too long (${originalLength} > ${this.config.maxInputChars}), splitting into segments`,
      );
      return this.generateSummaryForLongConversation(transcripts, callDate);
    }

    // Bedrock 클라이언트가 없으면 Fallback
    if (!this.bedrockClient) {
      this.logger.warn('Bedrock client not available, using fallback mode');
      return this.createFallbackResult(transcripts, callDate);
    }

    try {
      const result = await this.invokeSummaryLLM(originalText, callDate);
      this.debug(
        `Summary generated: ${result.summaryText.length} chars, ${result.chunks.length} chunks`,
      );
      return {
        ...result,
        metadata: {
          ...result.metadata,
          originalLength,
        },
      };
    } catch (error) {
      this.logger.error(
        `LLM summary failed: ${error.message}, using fallback`,
        error.stack,
      );
      return this.createFallbackResult(transcripts, callDate);
    }
  }

  /**
   * 긴 대화를 분할하여 각각 요약 후 통합
   */
  private async generateSummaryForLongConversation(
    transcripts: TranscriptLine[],
    callDate: string,
  ): Promise<DenseSummaryResult> {
    const segments = this.splitTranscriptsIntoSegments(transcripts);
    this.logger.log(`Split long conversation into ${segments.length} segments`);

    const allChunks: ContextualChunk[] = [];
    const allSummaries: string[] = [];
    const allTopics: Set<string> = new Set();
    const allKeywords: Set<string> = new Set();

    for (let i = 0; i < segments.length; i++) {
      try {
        const segmentText = this.formatTranscripts(segments[i]);
        const result = await this.invokeSummaryLLM(segmentText, callDate);

        allSummaries.push(result.summaryText);
        allChunks.push(...result.chunks);
        result.metadata.topics.forEach(t => allTopics.add(t));
        result.metadata.keywords.forEach(k => allKeywords.add(k));

        this.debug(
          `Segment ${i + 1}/${segments.length} processed: ${result.chunks.length} chunks`,
        );
      } catch (error) {
        this.logger.warn(
          `Segment ${i + 1} failed, using fallback: ${error.message}`,
        );
        const fallback = this.createFallbackResult(segments[i], callDate);
        allSummaries.push(fallback.summaryText);
        allChunks.push(...fallback.chunks);
      }
    }

    const combinedSummary = allSummaries.join('\n\n');
    const originalLength = transcripts.reduce(
      (acc, t) => acc + t.text.length,
      0,
    );

    return {
      summaryText: combinedSummary,
      chunks: allChunks,
      metadata: {
        originalLength,
        summaryLength: combinedSummary.length,
        chunkCount: allChunks.length,
        topics: Array.from(allTopics),
        keywords: Array.from(allKeywords),
      },
    };
  }

  /**
   * LLM 호출하여 요약 + 청크 동시 생성
   */
  private async invokeSummaryLLM(
    text: string,
    callDate: string,
  ): Promise<DenseSummaryResult> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(text, callDate);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.bedrockMaxRetries; attempt++) {
      try {
        const response = await this.callClaude(systemPrompt, userPrompt);
        return this.parseResponse(response, callDate);
      } catch (error) {
        lastError = error;
        if (attempt < this.config.bedrockMaxRetries - 1) {
          const delay =
            this.config.bedrockRetryDelayMs *
            Math.pow(this.config.bedrockRetryBackoffFactor, attempt);
          this.logger.warn(
            `LLM call failed (attempt ${attempt + 1}/${this.config.bedrockMaxRetries}): ${error.message}. Retrying in ${delay}ms`,
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('LLM invocation failed after all retries');
  }

  /**
   * Claude API 호출
   */
  private async callClaude(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    if (!this.bedrockClient) {
      throw new Error('Bedrock client not initialized');
    }

    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.config.summaryMaxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: this.config.summaryModel,
      body: JSON.stringify(requestBody),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const timeoutMs = this.config.summaryRequestTimeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.bedrockClient.send(command, {
        abortSignal: controller.signal,
      });
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (!responseBody.content || !responseBody.content[0]?.text) {
        throw new Error('Invalid response from Claude');
      }

      return responseBody.content[0].text;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 시스템 프롬프트 구성
   *
   * 핵심 지시사항:
   * 1. 고유명사 100% 보존 (약 이름, 가족 이름, 병원명 등)
   * 2. 대명사를 구체적 명사로 치환
   * 3. 수치 정보 완벽 보존 (혈압, 시간, 날짜 등)
   * 4. JSON 형태로 청크 배열 반환 (LLM Call 횟수 최소화)
   */
  private buildSystemPrompt(): string {
    return `너는 노인 돌봄 기록 전문가야. 어르신과의 대화를 정리하여 나중에 검색하기 쉽도록 만들어야 해.

## 절대 규칙 (반드시 지켜야 함)

1. **고유명사 100% 보존**
   - 약 이름 (예: "빨간 약" → "빨간색 알약(혈압약)"처럼 구체화하되, 원래 표현도 유지)
   - 사람 이름 (예: 아들 이름 '철수', 딸 이름 '영희' 등 절대 일반 명사로 바꾸지 마)
   - 병원/기관명 (예: "서울대병원", "강남보건소" 등)
   - 장소명 (예: "동대문시장", "집 앞 공원" 등)

2. **대명사 → 구체적 명사 치환**
   - "그때" → 구체적 날짜나 상황으로
   - "그거" → 구체적 대상으로
   - "거기" → 구체적 장소로

3. **수치/시간 정보 완벽 보존**
   - 혈압 수치 (예: "120/80")
   - 복용 시간 (예: "아침 8시")
   - 병원 방문 일정 (예: "다음주 화요일 오후 2시")
   - 가족 방문 일정

4. **감정/건강 상태 기록**
   - 통증 호소 내용
   - 수면 상태
   - 식사 여부
   - 기분/감정 상태

## 출력 형식

반드시 아래 JSON 형식으로만 응답해. 다른 텍스트 없이 JSON만 출력해.

\`\`\`json
{
  "summary": "전체 대화의 상세 요약문 (팩트 100% 보존, 서술형으로 작성)",
  "chunks": [
    {
      "header": "[YYYY-MM-DD | 주제분류 | 핵심키워드1, 핵심키워드2]",
      "content": "150자 내외의 청크 내용"
    }
  ],
  "topics": ["건강관리", "가족", "일상생활"],
  "keywords": ["혈압약", "아들 철수", "병원예약"]
}
\`\`\`

## 청크 작성 규칙

1. **청크 크기**: 각 청크는 130~180자 사이로 작성
2. **문장 완결성**: 단어나 문장이 중간에 잘리지 않도록 함
3. **헤더 형식**: \`[날짜 | 주제분류 | 키워드1, 키워드2]\`
   - 주제분류: 건강관리, 가족관계, 일상생활, 감정상태, 일정, 기타 중 선택
   - 키워드: 해당 청크에서 가장 중요한 검색어 2-3개

4. **독립적 검색 가능**: 각 청크는 헤더만 보고도 내용을 짐작할 수 있어야 함`;
  }

  /**
   * 사용자 프롬프트 구성
   */
  private buildUserPrompt(text: string, callDate: string): string {
    return `다음은 ${callDate}에 있었던 어르신과의 대화 기록이야.
위의 규칙에 따라 상세 요약과 검색용 청크를 만들어줘.

---
${text}
---

JSON 형식으로만 응답해.`;
  }

  /**
   * LLM 응답 파싱
   */
  private parseResponse(
    response: string,
    callDate: string,
  ): DenseSummaryResult {
    try {
      // JSON 블록 추출 (```json ... ``` 또는 순수 JSON)
      let jsonStr = response;

      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      } else {
        // 순수 JSON인 경우 중괄호 찾기
        const startIdx = response.indexOf('{');
        const endIdx = response.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1) {
          jsonStr = response.substring(startIdx, endIdx + 1);
        }
      }

      const parsed = JSON.parse(jsonStr);

      // 청크 배열 변환
      const chunks: ContextualChunk[] = (parsed.chunks || []).map(
        (chunk: any) => ({
          header: chunk.header || `[${callDate} | 기타 | 대화]`,
          content: chunk.content || '',
          fullText: `${chunk.header || ''} ${chunk.content || ''}`.trim(),
        }),
      );

      return {
        summaryText: parsed.summary || '',
        chunks,
        metadata: {
          originalLength: 0, // 상위에서 설정
          summaryLength: (parsed.summary || '').length,
          chunkCount: chunks.length,
          topics: parsed.topics || [],
          keywords: parsed.keywords || [],
        },
      };
    } catch (error) {
      this.logger.error(`Failed to parse LLM response: ${error.message}`);
      throw new Error(`LLM response parsing failed: ${error.message}`);
    }
  }

  /**
   * Fallback: LLM 실패 시 원본 기반 청크 생성
   */
  private createFallbackResult(
    transcripts: TranscriptLine[],
    callDate: string,
  ): DenseSummaryResult {
    this.logger.warn(
      'Using fallback mode: creating chunks from raw transcripts',
    );

    const text = this.formatTranscripts(transcripts);
    const chunks = this.createSimpleChunks(text, callDate);

    return {
      summaryText: text,
      chunks,
      metadata: {
        originalLength: text.length,
        summaryLength: text.length,
        chunkCount: chunks.length,
        topics: ['대화'],
        keywords: this.extractSimpleKeywords(transcripts),
      },
    };
  }

  /**
   * 간단한 청킹 (Fallback용)
   */
  private createSimpleChunks(
    text: string,
    callDate: string,
  ): ContextualChunk[] {
    const chunks: ContextualChunk[] = [];
    let currentPos = 0;

    while (currentPos < text.length) {
      let endPos = Math.min(
        currentPos + this.config.contextualChunkMax,
        text.length,
      );

      // 문장 경계 찾기
      if (endPos < text.length) {
        const searchStart = Math.max(currentPos, endPos - 40);
        const searchText = text.substring(searchStart, endPos + 20);
        const sentenceEndings = [
          '. ',
          '.\n',
          '? ',
          '!\n',
          '다. ',
          '요. ',
          '습니다. ',
        ];

        let bestBoundary = -1;
        for (const ending of sentenceEndings) {
          const idx = searchText.lastIndexOf(ending);
          if (idx !== -1) {
            const candidate = searchStart + idx + ending.length;
            if (candidate > bestBoundary && candidate > currentPos) {
              bestBoundary = candidate;
            }
          }
        }

        if (bestBoundary > currentPos) {
          endPos = bestBoundary;
        }
      }

      const content = text.substring(currentPos, endPos).trim();
      if (content.length > 0) {
        const keywords = this.extractKeywordsFromText(content);
        const header = `[${callDate} | 대화 | ${keywords.slice(0, 2).join(', ') || '기록'}]`;

        chunks.push({
          header,
          content,
          fullText: `${header} ${content}`,
        });
      }

      currentPos = endPos;
    }

    return chunks;
  }

  /**
   * 텍스트에서 간단한 키워드 추출
   */
  private extractKeywordsFromText(text: string): string[] {
    const keywords: string[] = [];

    // 건강 관련 키워드
    const healthPatterns = [
      /혈압/g,
      /약/g,
      /병원/g,
      /아프/g,
      /통증/g,
      /수면/g,
      /잠/g,
      /식사/g,
      /밥/g,
      /운동/g,
      /산책/g,
      /검사/g,
      /진료/g,
    ];

    // 가족 관련 키워드
    const familyPatterns = [
      /아들/g,
      /딸/g,
      /손자/g,
      /손녀/g,
      /며느리/g,
      /사위/g,
      /자녀/g,
      /가족/g,
      /아이/g,
      /전화/g,
      /방문/g,
    ];

    // 감정 관련 키워드
    const emotionPatterns = [
      /기쁘/g,
      /슬프/g,
      /외롭/g,
      /걱정/g,
      /행복/g,
      /우울/g,
    ];

    const allPatterns = [
      ...healthPatterns,
      ...familyPatterns,
      ...emotionPatterns,
    ];

    for (const pattern of allPatterns) {
      if (pattern.test(text)) {
        const keyword = pattern.source.replace(/\\|[g]/g, '');
        if (!keywords.includes(keyword)) {
          keywords.push(keyword);
        }
        pattern.lastIndex = 0; // Reset regex
      }
    }

    return keywords.slice(0, 5);
  }

  /**
   * 트랜스크립트에서 간단한 키워드 추출
   */
  private extractSimpleKeywords(transcripts: TranscriptLine[]): string[] {
    const text = transcripts.map(t => t.text).join(' ');
    return this.extractKeywordsFromText(text);
  }

  /**
   * 트랜스크립트 배열을 텍스트로 변환
   */
  private formatTranscripts(transcripts: TranscriptLine[]): string {
    return transcripts.map(t => `[${t.speaker}]: ${t.text}`).join('\n');
  }

  /**
   * 긴 트랜스크립트를 세그먼트로 분할
   */
  private splitTranscriptsIntoSegments(
    transcripts: TranscriptLine[],
  ): TranscriptLine[][] {
    const segments: TranscriptLine[][] = [];
    let currentSegment: TranscriptLine[] = [];
    let currentLength = 0;

    for (const transcript of transcripts) {
      const lineLength = `[${transcript.speaker}]: ${transcript.text}`.length;

      if (
        currentLength + lineLength > this.config.maxInputChars &&
        currentSegment.length > 0
      ) {
        segments.push(currentSegment);
        currentSegment = [];
        currentLength = 0;
      }

      currentSegment.push(transcript);
      currentLength += lineLength;
    }

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    return segments;
  }

  /**
   * 빈 결과 생성
   */
  private createEmptyResult(): DenseSummaryResult {
    return {
      summaryText: '',
      chunks: [],
      metadata: {
        originalLength: 0,
        summaryLength: 0,
        chunkCount: 0,
        topics: [],
        keywords: [],
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private debug(message: string): void {
    if (this.config.debugLogs) {
      this.logger.debug(message);
    }
  }
}
