import { PrismaClient } from '@prisma/client';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

// Use DATABASE_URL from env, or fallback to localhost
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://damso:pw@localhost:5432/damso';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

// Create Bedrock client with timeout configuration
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  requestHandler: {
    requestTimeout: 30000, // 30 seconds timeout
  },
});

// AWS Bedrock Models
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0';
const LLM_MODEL =
  process.env.BEDROCK_SUMMARY_MODEL ||
  process.env.BEDROCK_MODEL ||
  'anthropic.claude-3-5-sonnet-20241022-v2:0';
const MAX_TOKENS = 4000;

const KST_OFFSET_HOURS = 9; // UTC+9 for Korea Standard Time

// Types for Dense Summary
interface ContextualChunk {
  header: string;
  content: string;
  fullText: string;
}

interface DenseSummaryResult {
  summaryText: string;
  chunks: ContextualChunk[];
  metadata: {
    originalLength: number;
    summaryLength: number;
    chunkCount: number;
    topics: string[];
    keywords: string[];
  };
}

/**
 * Convert UTC Date to KST (Korea Standard Time, UTC+9)
 */
function toKST(utcDate: Date): Date {
  const kstDate = new Date(utcDate);
  kstDate.setHours(kstDate.getHours() + KST_OFFSET_HOURS);
  return kstDate;
}

/**
 * Format KST date as "YYYY-MM-DD HH:mm KST"
 */
function formatKST(kstDate: Date): string {
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  const hours = String(kstDate.getHours()).padStart(2, '0');
  const minutes = String(kstDate.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} KST`;
}

/**
 * Generate embedding using AWS Bedrock Titan V2
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const input = {
      modelId: EMBEDDING_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: 1024,
        normalize: true,
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    // Convert Uint8Array to string more efficiently
    const bodyBytes = response.body;
    if (!bodyBytes) {
      throw new Error('Empty response body from Bedrock');
    }

    const responseBody = JSON.parse(Buffer.from(bodyBytes).toString('utf-8'));
    const embedding = responseBody.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from Bedrock');
    }

    return embedding;
  } catch (error) {
    console.error(`Failed to generate embedding: ${error}`);
    throw error;
  }
}

/**
 * Generate dense summary with contextual chunks using Claude LLM
 * Same logic as RagSummaryService.generateDenseSummaryWithChunks
 */
async function generateDenseSummary(
  conversations: Array<{ speaker: string; text: string }>,
  callDate: string,
): Promise<DenseSummaryResult> {
  const originalText = conversations
    .map(c => `[${c.speaker}]: ${c.text}`)
    .join('\n');
  const originalLength = originalText.length;

  console.log(
    `  🤖 Generating dense summary with LLM (${originalLength} chars)...`,
  );

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(originalText, callDate);

    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    };

    const command = new InvokeModelCommand({
      modelId: LLM_MODEL,
      body: JSON.stringify(requestBody),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.content || !responseBody.content[0]?.text) {
      throw new Error('Invalid response from Claude');
    }

    const llmResponse = responseBody.content[0].text;
    const result = parseResponse(llmResponse, callDate, originalLength);

    console.log(`  ✅ Summary generated: ${result.chunks.length} chunks`);
    return result;
  } catch (error) {
    console.warn(`  ⚠️  LLM failed: ${error.message}, using fallback`);
    return createFallbackSummary(conversations, callDate, originalLength);
  }
}

/**
 * Build system prompt (same as RagSummaryService)
 */
function buildSystemPrompt(): string {
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
 * Build user prompt
 */
function buildUserPrompt(text: string, callDate: string): string {
  return `다음은 ${callDate}에 있었던 어르신과의 대화 기록이야.
위의 규칙에 따라 상세 요약과 검색용 청크를 만들어줘.

---
${text}
---

JSON 형식으로만 응답해.`;
}

/**
 * Parse LLM response
 */
function parseResponse(
  response: string,
  callDate: string,
  originalLength: number,
): DenseSummaryResult {
  // Extract JSON block
  let jsonStr = response;

  const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    const startIdx = response.indexOf('{');
    const endIdx = response.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      jsonStr = response.substring(startIdx, endIdx + 1);
    }
  }

  const parsed = JSON.parse(jsonStr);

  const chunks: ContextualChunk[] = (parsed.chunks || []).map((chunk: any) => ({
    header: chunk.header || `[${callDate} | 기타 | 대화]`,
    content: chunk.content || '',
    fullText: `${chunk.header || ''} ${chunk.content || ''}`.trim(),
  }));

  return {
    summaryText: parsed.summary || '',
    chunks,
    metadata: {
      originalLength,
      summaryLength: (parsed.summary || '').length,
      chunkCount: chunks.length,
      topics: parsed.topics || [],
      keywords: parsed.keywords || [],
    },
  };
}

/**
 * Create fallback summary when LLM fails
 */
function createFallbackSummary(
  conversations: Array<{ speaker: string; text: string }>,
  callDate: string,
  originalLength: number,
): DenseSummaryResult {
  const text = conversations.map(c => `[${c.speaker}]: ${c.text}`).join('\n');

  // Simple chunking
  const chunks: ContextualChunk[] = [];
  const CHUNK_SIZE = 150;
  let currentPos = 0;

  while (currentPos < text.length) {
    const endPos = Math.min(currentPos + CHUNK_SIZE, text.length);
    const content = text.substring(currentPos, endPos).trim();

    if (content.length > 0) {
      const header = `[${callDate} | 대화 | 기록]`;
      chunks.push({
        header,
        content,
        fullText: `${header} ${content}`,
      });
    }

    currentPos = endPos;
  }

  return {
    summaryText: text,
    chunks,
    metadata: {
      originalLength,
      summaryLength: text.length,
      chunkCount: chunks.length,
      topics: ['대화'],
      keywords: [],
    },
  };
}

/**
 * Split parent text into child chunks (same logic as rag.utils.ts)
 */
function splitIntoChildChunks(
  parentText: string,
  childSize: number = 200,
  overlap: number = 50,
): Array<{ text: string; offsetStart: number; offsetEnd: number }> {
  if (!parentText || parentText.length === 0) {
    return [];
  }

  const chunks: Array<{
    text: string;
    offsetStart: number;
    offsetEnd: number;
  }> = [];
  let currentStart = 0;

  while (currentStart < parentText.length) {
    let currentEnd = Math.min(currentStart + childSize, parentText.length);

    // Try to find a sentence boundary near the target end
    if (currentEnd < parentText.length) {
      const searchStart = Math.max(
        currentStart,
        currentEnd - Math.floor(childSize * 0.2),
      );
      const searchText = parentText.substring(searchStart, currentEnd + 20);

      // Korean and English sentence endings
      const sentenceEndings = ['\n\n', '. ', '! ', '? ', '。 ', '！ ', '？ '];
      let bestBoundary = -1;

      for (const ending of sentenceEndings) {
        const idx = searchText.lastIndexOf(ending);
        if (idx !== -1) {
          bestBoundary = searchStart + idx + ending.length;
          break;
        }
      }

      if (bestBoundary > currentStart) {
        currentEnd = bestBoundary;
      }
    }

    // Add chunk
    const chunkText = parentText.substring(currentStart, currentEnd).trim();
    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        offsetStart: currentStart,
        offsetEnd: currentEnd,
      });
    }

    // Move to next chunk with overlap
    const nextStart = currentEnd - overlap;

    // Safety check: ensure we're making progress
    if (nextStart <= currentStart) {
      // If we're not making progress, move forward by at least 1 character
      currentStart = currentEnd;
    } else {
      currentStart = nextStart;
    }

    // Break if we're near the end
    if (currentStart >= parentText.length - 10) {
      break;
    }
  }

  return chunks;
}

/**
 * 다양한 테스트 대화 데이터
 */
const testConversations = [
  {
    date: '2026-01-10T10:30:00+09:00',
    conversations: [
      { speaker: 'agent', text: '안녕하세요! 오늘 아침은 드셨어요?' },
      { speaker: 'user', text: '네, 아침에 미역국이랑 밥 먹었어요.' },
      { speaker: 'agent', text: '미역국 좋아하시나 봐요! 맛있게 드셨어요?' },
      {
        speaker: 'user',
        text: '네, 며느리가 해줘서 맛있었어요. 요즘 무릎이 좀 아파서 걱정이에요.',
      },
      {
        speaker: 'agent',
        text: '무릎이 아프시다니 걱정이네요. 병원에는 다녀오셨어요?',
      },
      { speaker: 'user', text: '다음 주에 정형외과 예약했어요.' },
    ],
  },
  {
    date: '2026-01-09T14:20:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 날씨가 참 좋네요! 산책 다녀오셨어요?' },
      {
        speaker: 'user',
        text: '네, 아까 공원에 다녀왔어요. 친구들이랑 같이요.',
      },
      { speaker: 'agent', text: '좋으시겠어요! 어떤 이야기 나누셨어요?' },
      {
        speaker: 'user',
        text: '옛날 이야기도 하고, 손주들 자랑도 하고 그랬어요. 우리 손주가 이번에 대학 합격했거든요.',
      },
      { speaker: 'agent', text: '와, 축하드려요! 어느 대학이에요?' },
      { speaker: 'user', text: '서울대학교요! 정말 자랑스러워요.' },
    ],
  },
  {
    date: '2026-01-08T09:15:00+09:00',
    conversations: [
      { speaker: 'agent', text: '어제 밤에 잘 주무셨어요?' },
      { speaker: 'user', text: '아니요, 잠을 잘 못 잤어요. 자꾸 깨더라고요.' },
      { speaker: 'agent', text: '그러셨군요. 혹시 걱정되는 일이 있으세요?' },
      {
        speaker: 'user',
        text: '아들이 요즘 회사 일로 힘들어하는 것 같아서요.',
      },
      {
        speaker: 'agent',
        text: '가족 걱정이 많으시겠어요. 아드님과 통화는 하셨어요?',
      },
      {
        speaker: 'user',
        text: '어제 통화했는데, 괜찮다고는 하는데 목소리가 피곤해 보였어요.',
      },
    ],
  },
  {
    date: '2026-01-07T16:45:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 점심은 뭐 드셨어요?' },
      { speaker: 'user', text: '김치찌개랑 밥 먹었어요. 혼자 해먹었어요.' },
      { speaker: 'agent', text: '직접 요리하셨네요! 요리 자주 하세요?' },
      { speaker: 'user', text: '네, 매일 해요. 혼자 사니까 직접 해먹어야죠.' },
      { speaker: 'agent', text: '대단하세요! 건강관리 잘 하시는 것 같아요.' },
      {
        speaker: 'user',
        text: '그래도 가끔은 외로워요. 같이 밥 먹을 사람이 없으니까.',
      },
    ],
  },
  {
    date: '2026-01-06T11:00:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 기분은 어떠세요?' },
      {
        speaker: 'user',
        text: '좋아요! 오늘 날씨도 좋고, 손주가 전화했거든요.',
      },
      {
        speaker: 'agent',
        text: '손주분이 전화하셨군요! 무슨 이야기 하셨어요?',
      },
      { speaker: 'user', text: '이번 주말에 놀러 온대요. 정말 기대돼요.' },
      {
        speaker: 'agent',
        text: '좋은 주말 보내시겠네요! 뭐 해주실 계획이세요?',
      },
      {
        speaker: 'user',
        text: '손주가 좋아하는 잡채 만들어줄 거예요. 고기도 사야겠어요.',
      },
    ],
  },
  {
    date: '2026-01-05T13:30:00+09:00',
    conversations: [
      { speaker: 'agent', text: '약은 잘 드시고 계세요?' },
      {
        speaker: 'user',
        text: '네, 아침저녁으로 먹고 있어요. 혈압약이랑 당뇨약이요.',
      },
      { speaker: 'agent', text: '규칙적으로 잘 드시는군요. 혈압은 어때요?' },
      { speaker: 'user', text: '요즘은 괜찮아요. 130/80 정도 나와요.' },
      {
        speaker: 'agent',
        text: '잘 관리하고 계시네요! 병원 정기검진도 받으세요?',
      },
      {
        speaker: 'user',
        text: '네, 한 달에 한 번씩 가요. 다음 주가 검진 날이에요.',
      },
    ],
  },
  {
    date: '2026-01-04T15:20:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 TV에서 뭐 보셨어요?' },
      { speaker: 'user', text: '아침 드라마 봤어요. 요즘 재미있어요.' },
      { speaker: 'agent', text: '어떤 내용인데요?' },
      {
        speaker: 'user',
        text: '가족 이야기인데, 우리 집 이야기 같아서 더 재미있어요.',
      },
      { speaker: 'agent', text: '공감되는 부분이 많으신가 봐요.' },
      {
        speaker: 'user',
        text: '네, 옛날 생각도 나고 그래요. 젊었을 때가 그립네요.',
      },
    ],
  },
  {
    date: '2026-01-03T10:00:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 운동하셨어요?' },
      {
        speaker: 'user',
        text: '네, 아침에 스트레칭 했어요. 요가 영상 보면서요.',
      },
      { speaker: 'agent', text: '건강관리 열심히 하시네요! 매일 하세요?' },
      { speaker: 'user', text: '네, 매일 30분씩 해요. 안 하면 몸이 뻐근해요.' },
      { speaker: 'agent', text: '좋은 습관이에요! 몸 상태는 어떠세요?' },
      {
        speaker: 'user',
        text: '예전보다 훨씬 좋아졌어요. 허리 통증도 많이 줄었고요.',
      },
    ],
  },
  {
    date: '2026-01-02T14:45:00+09:00',
    conversations: [
      {
        speaker: 'agent',
        text: '새해 복 많이 받으세요! 새해 계획 세우셨어요?',
      },
      { speaker: 'user', text: '네, 올해는 건강하게 지내는 게 목표예요.' },
      { speaker: 'agent', text: '좋은 목표네요! 구체적인 계획이 있으세요?' },
      {
        speaker: 'user',
        text: '매일 산책하고, 약 잘 챙겨먹고, 친구들 자주 만나려고요.',
      },
      { speaker: 'agent', text: '실천 가능한 좋은 계획이에요! 응원할게요.' },
      { speaker: 'user', text: '고마워요. 올해는 꼭 지킬 거예요.' },
    ],
  },
  {
    date: '2026-01-01T11:30:00+09:00',
    conversations: [
      { speaker: 'agent', text: '새해 첫날이네요! 어떻게 보내셨어요?' },
      { speaker: 'user', text: '가족들이랑 떡국 먹었어요. 다 같이 모였어요.' },
      { speaker: 'agent', text: '가족들과 좋은 시간 보내셨겠어요!' },
      {
        speaker: 'user',
        text: '네, 정말 행복했어요. 손주들도 세배하러 왔고요.',
      },
      { speaker: 'agent', text: '세뱃돈도 주셨겠네요?' },
      {
        speaker: 'user',
        text: '네, 손주들한테 용돈 줬어요. 기뻐하는 모습 보니 좋더라고요.',
      },
    ],
  },
  // 추가 10건의 다양한 대화
  {
    date: '2025-12-31T17:00:00+09:00',
    conversations: [
      { speaker: 'agent', text: '내일이 새해네요! 준비는 다 하셨어요?' },
      {
        speaker: 'user',
        text: '네, 떡국 재료 사놨어요. 떡이랑 고명 준비했어요.',
      },
      {
        speaker: 'agent',
        text: '직접 만드시나 봐요! 요리 솜씨가 좋으시겠어요.',
      },
      {
        speaker: 'user',
        text: '옛날부터 해왔으니까요. 우리 집 떡국은 맛있다고 소문났어요.',
      },
      { speaker: 'agent', text: '가족들이 좋아하시겠어요!' },
      {
        speaker: 'user',
        text: '네, 내일 아들네 가족이 다 와요. 벌써부터 기대돼요.',
      },
    ],
  },
  {
    date: '2025-12-30T10:30:00+09:00',
    conversations: [
      { speaker: 'agent', text: '요즘 날씨가 많이 춥죠? 감기 조심하세요.' },
      { speaker: 'user', text: '네, 집에만 있어요. 밖에 나가기 무서워요.' },
      { speaker: 'agent', text: '그러시군요. 집에서 뭐 하시며 시간 보내세요?' },
      {
        speaker: 'user',
        text: '책도 읽고, TV도 보고, 뜨개질도 해요. 손주 목도리 만들고 있어요.',
      },
      {
        speaker: 'agent',
        text: '뜨개질 하시는구나! 취미가 있으시니 좋으시겠어요.',
      },
      {
        speaker: 'user',
        text: '네, 손으로 뭔가 만드는 게 재미있어요. 치매 예방에도 좋대요.',
      },
    ],
  },
  {
    date: '2025-12-29T20:00:00+09:00',
    conversations: [
      { speaker: 'agent', text: '저녁 식사는 하셨어요?' },
      { speaker: 'user', text: '네, 아까 먹었어요. 오늘은 일찍 먹었어요.' },
      { speaker: 'agent', text: '뭐 드셨어요?' },
      { speaker: 'user', text: '된장찌개랑 생선구이요. 간단하게 먹었어요.' },
      { speaker: 'agent', text: '건강한 식단이네요! 생선 자주 드세요?' },
      {
        speaker: 'user',
        text: '네, 일주일에 두세 번은 먹어요. 고기보다 생선이 더 좋대요.',
      },
    ],
  },
  {
    date: '2025-12-28T08:30:00+09:00',
    conversations: [
      { speaker: 'agent', text: '어젯밤에 잘 주무셨어요?' },
      { speaker: 'user', text: '네, 어제는 잘 잤어요. 꿈도 좋은 꿈 꿨어요.' },
      { speaker: 'agent', text: '어떤 꿈이었어요?' },
      {
        speaker: 'user',
        text: '돌아가신 남편이 나왔어요. 젊었을 때 모습으로요.',
      },
      { speaker: 'agent', text: '그러셨군요. 많이 보고 싶으시겠어요.' },
      {
        speaker: 'user',
        text: '네, 가끔 꿈에서라도 보면 좋아요. 옛날 생각도 나고요.',
      },
    ],
  },
  {
    date: '2025-12-27T15:45:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 병원 다녀오셨다고 하셨죠?' },
      {
        speaker: 'user',
        text: '네, 정기검진 받고 왔어요. 혈액검사도 했어요.',
      },
      { speaker: 'agent', text: '결과는 어땠어요?' },
      {
        speaker: 'user',
        text: '다행히 다 정상이래요. 의사 선생님이 건강하시다고 하셨어요.',
      },
      { speaker: 'agent', text: '다행이네요! 계속 건강 관리 잘 하세요.' },
      {
        speaker: 'user',
        text: '네, 약도 잘 먹고 운동도 하고 있어요. 건강이 제일이에요.',
      },
    ],
  },
  {
    date: '2025-12-26T12:00:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 교회 다녀오셨어요?' },
      {
        speaker: 'user',
        text: '네, 주일예배 드리고 왔어요. 성탄절 다음 날이라 특별했어요.',
      },
      { speaker: 'agent', text: '교회에서 어떤 이야기 나누셨어요?' },
      {
        speaker: 'user',
        text: '목사님이 감사에 대해 말씀하셨어요. 정말 은혜로웠어요.',
      },
      {
        speaker: 'agent',
        text: '좋은 말씀 들으셨네요. 교회 친구분들도 만나셨어요?',
      },
      {
        speaker: 'user',
        text: '네, 점심도 같이 먹고 왔어요. 친구들 만나니까 기분이 좋아요.',
      },
    ],
  },
  {
    date: '2025-12-25T16:30:00+09:00',
    conversations: [
      { speaker: 'agent', text: '메리 크리스마스! 오늘 어떻게 보내셨어요?' },
      {
        speaker: 'user',
        text: '가족들이 다 모였어요. 손주들이 선물도 줬어요.',
      },
      { speaker: 'agent', text: '어떤 선물 받으셨어요?' },
      {
        speaker: 'user',
        text: '따뜻한 조끼랑 목도리요. 손주들이 골라줬대요.',
      },
      { speaker: 'agent', text: '정성스러운 선물이네요! 기분 좋으시겠어요.' },
      {
        speaker: 'user',
        text: '네, 정말 행복한 크리스마스였어요. 가족이 최고예요.',
      },
    ],
  },
  {
    date: '2025-12-24T09:00:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 화분에 물 주셨어요?' },
      {
        speaker: 'user',
        text: '네, 아침에 다 줬어요. 베란다에 화분이 10개나 있어요.',
      },
      { speaker: 'agent', text: '식물 키우시는 걸 좋아하시나 봐요!' },
      {
        speaker: 'user',
        text: '네, 식물 보면 마음이 편해져요. 꽃 피는 것도 기다려지고요.',
      },
      { speaker: 'agent', text: '어떤 식물들 키우세요?' },
      {
        speaker: 'user',
        text: '난초, 선인장, 허브 같은 거요. 허브는 요리할 때도 써요.',
      },
    ],
  },
  {
    date: '2025-12-23T14:20:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 며느리한테 전화 왔다고 하셨죠?' },
      {
        speaker: 'user',
        text: '네, 아까 통화했어요. 크리스마스에 올 거래요.',
      },
      { speaker: 'agent', text: '좋은 소식이네요! 뭐 준비하실 거예요?' },
      {
        speaker: 'user',
        text: '며느리가 좋아하는 갈비찜 만들려고요. 고기 사러 가야 해요.',
      },
      { speaker: 'agent', text: '요리 준비하시느라 바쁘시겠어요.' },
      {
        speaker: 'user',
        text: '괜찮아요. 가족 위해 요리하는 게 행복해요. 기다려져요.',
      },
    ],
  },
  {
    date: '2025-12-22T11:15:00+09:00',
    conversations: [
      { speaker: 'agent', text: '오늘 시장 다녀오셨어요?' },
      {
        speaker: 'user',
        text: '네, 아침에 다녀왔어요. 장 보는 날이거든요.',
      },
      { speaker: 'agent', text: '뭐 사오셨어요?' },
      {
        speaker: 'user',
        text: '채소랑 과일이요. 사과가 싸길래 많이 샀어요.',
      },
      { speaker: 'agent', text: '시장 가시는 게 즐거우세요?' },
      {
        speaker: 'user',
        text: '네, 시장 아주머니들이랑 이야기하는 것도 재미있어요. 단골이라 친해요.',
      },
    ],
  },
];

/**
 * Insert test conversation data into PGvector
 */
async function seedTestData() {
  try {
    console.log('🔍 Finding wards with isRegistered=true...');

    // Find wards where isRegistered is true
    const registeredWards = await prisma.organizationWard.findMany({
      where: {
        isRegistered: true,
        wardId: { not: null },
      },
      select: {
        wardId: true,
        name: true,
      },
      take: 5,
    });

    if (registeredWards.length === 0) {
      console.log('❌ No registered wards found with wardId');
      return;
    }

    console.log(`✅ Found ${registeredWards.length} registered wards:`);
    registeredWards.forEach((w, i) => {
      console.log(`  ${i + 1}. Ward ID: ${w.wardId}, Name: ${w.name}`);
    });

    // Use the first registered ward for testing
    const targetWardId = registeredWards[0].wardId!;
    console.log(
      `\n🎯 Using ward: ${targetWardId} (${registeredWards[0].name})`,
    );

    console.log('\n📝 Inserting test conversation data...\n');

    // Process all conversations with batch processing to avoid memory issues
    const conversationsToProcess = testConversations;
    console.log(
      `Processing ${conversationsToProcess.length} conversations with batch processing...\n`,
    );

    for (const [index, conversation] of conversationsToProcess.entries()) {
      const callId = crypto.randomUUID();
      const { date, conversations } = conversation;

      console.log(
        `[${index + 1}/${testConversations.length}] Processing conversation from ${date}...`,
      );

      // Create a Call record first to satisfy foreign key constraint
      const callDate = new Date(date);
      const roomName = `test-room-${callId}`;

      console.log('  📞 Creating Call record...');
      await prisma.call.create({
        data: {
          callId: callId,
          callerIdentity: 'agent',
          calleeIdentity: targetWardId,
          roomName: roomName,
          state: 'ended',
          createdAt: callDate,
          answeredAt: callDate,
          endedAt: new Date(callDate.getTime() + 5 * 60 * 1000), // 5 minutes later
        },
      });

      // Convert to KST
      const callStartKst = toKST(callDate);

      // v2: Generate Dense Summary with Contextual Chunks
      const callDateStr = formatKST(callStartKst).split(' ')[0]; // YYYY-MM-DD
      const summaryResult = await generateDenseSummary(
        conversations,
        callDateStr,
      );

      // Original conversation text (for parent_text backup)
      const originalText = conversations
        .map(c => `[${c.speaker}]: ${c.text}`)
        .join('\n');

      // Summary text with date prefix
      const datePrefix = `[날짜: ${formatKST(callStartKst)}]`;
      const summaryTextWithDate = `${datePrefix} ${summaryResult.summaryText}`;

      // Prepare metadata (v2 format)
      const metadata = {
        speakers: ['agent', 'user'],
        timestamp: callDate.toISOString(),
        callDate: callDate.toISOString(),
        callStartAt: callDate.toISOString(),
        topics: summaryResult.metadata.topics,
        keywords: summaryResult.metadata.keywords,
        originalLength: summaryResult.metadata.originalLength,
        summaryLength: summaryResult.metadata.summaryLength,
        chunkCount: summaryResult.metadata.chunkCount,
        indexVersion: 'v2-dense-summary',
        testData: true,
      };

      // STEP 1: Insert PARENT with summary_text
      console.log('  💾 Inserting PARENT with Dense Summary...');
      const parentResult = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO conversation_vectors_parent (
          ward_id, call_id, parent_text, summary_text, metadata
        )
        VALUES (
          ${targetWardId}::uuid,
          ${callId}::uuid,
          ${originalText},
          ${summaryTextWithDate},
          ${JSON.stringify(metadata)}::jsonb
        )
        RETURNING id
      `;

      const parentId = parentResult[0]?.id;
      if (!parentId) {
        throw new Error('Failed to get parent ID after insert');
      }

      console.log(`  ✅ Parent inserted (ID: ${parentId})`);
      console.log(
        `  📊 Summary: ${summaryResult.summaryText.substring(0, 100)}...`,
      );

      // STEP 2: Insert CHILD chunks with contextual headers
      console.log(
        `  📦 Inserting ${summaryResult.chunks.length} contextual chunks...`,
      );

      const BATCH_SIZE = 50;
      for (
        let batchStart = 0;
        batchStart < summaryResult.chunks.length;
        batchStart += BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + BATCH_SIZE,
          summaryResult.chunks.length,
        );
        const batch = summaryResult.chunks.slice(batchStart, batchEnd);

        console.log(
          `  📦 Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (${batch.length} chunks)...`,
        );

        // Process batch sequentially to avoid memory issues
        for (let idx = 0; idx < batch.length; idx++) {
          const chunk = batch[idx];
          const globalIdx = batchStart + idx;

          console.log(
            `    [${globalIdx + 1}/${summaryResult.chunks.length}] Generating embedding for: ${chunk.header}`,
          );

          const embedding = await generateEmbedding(chunk.fullText);
          const childMetadata = {
            ...metadata,
            chunkIndex: globalIdx,
            header: chunk.header,
            contentLength: chunk.content.length,
          };

          // offset은 청크 순서 기준으로 대략 계산
          const offsetStart = globalIdx * 150;
          const offsetEnd = offsetStart + chunk.fullText.length;

          await prisma.$executeRaw`
            INSERT INTO conversation_vectors_child (
              parent_id, ward_id, call_id, child_text, chunk_header, embedding,
              offset_start, offset_end, metadata
            )
            VALUES (
              ${parentId}::uuid,
              ${targetWardId}::uuid,
              ${callId}::uuid,
              ${chunk.fullText},
              ${chunk.header},
              ${JSON.stringify(embedding)}::vector,
              ${offsetStart},
              ${offsetEnd},
              ${JSON.stringify(childMetadata)}::jsonb
            )
          `;
        }

        console.log(
          `  ✅ Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} inserted (${batch.length} children)`,
        );

        // Force garbage collection hint
        if (global.gc) {
          global.gc();
        }
      }

      console.log(
        `  ✅ Inserted ${summaryResult.chunks.length} children for parent ${parentId}\n`,
      );
    }

    console.log('🎉 All test data inserted successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`  - Ward ID: ${targetWardId}`);
    console.log(`  - Ward Name: ${registeredWards[0].name}`);
    console.log(
      `  - Total conversations (Parent): ${testConversations.length}`,
    );
    console.log(`  - Date range: 2025-12-22 ~ 2026-01-10`);
    console.log(`  - Index Version: v2-dense-summary`);
    console.log(
      `\n💡 Dense Summary: Each conversation is summarized by LLM with contextual headers`,
    );
  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
seedTestData();
