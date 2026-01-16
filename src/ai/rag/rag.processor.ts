import { Injectable, Logger } from '@nestjs/common';
import { RagConfig } from './rag.config';
import { RagEmbeddingService } from './rag.embedding.service';
import { RagSummaryService } from './rag.summary.service';
import {
  TranscriptLine,
  DenseSummaryResult,
  EmbeddedChunk,
  EmbeddedChildChunk,
  ParentChunk,
  ParentMetadata,
  ChildChunk,
} from './rag.types';
import { toKST, formatKST, splitIntoChildChunks } from './rag.utils';

/**
 * RAG Processor Service
 *
 * 대화 처리 로직을 담당하는 서비스입니다.
 * - v2: LLM 고밀도 요약 생성 + 문맥 헤더 청킹
 * - v1: 원본 텍스트 기반 청킹 (Fallback)
 * - 배치 임베딩 생성
 *
 * 핵심 기능:
 * 1. Single LLM Call로 요약 + 청크 배열 동시 생성 (비용 절감)
 * 2. LLM 실패 시 자동 Fallback (원본 기반 청킹)
 * 3. 고유명사, 수치, 감정 상태 100% 보존
 */
@Injectable()
export class RagProcessor {
  private readonly logger = new Logger(RagProcessor.name);

  constructor(
    private readonly config: RagConfig,
    private readonly embeddingService: RagEmbeddingService,
    private readonly summaryService: RagSummaryService,
  ) {}

  // ==========================================================================
  // v2: Dense Summary 처리
  // ==========================================================================

  /**
   * v2: 원본 대화를 고밀도 요약 + 문맥 헤더 청크로 변환
   *
   * Flow:
   * 1. LLM으로 요약 + 청크 생성 (Single Call)
   *
   * @param transcripts 원본 스크립트 배열
   * @param callDate 통화 날짜 (YYYY-MM-DD)
   * @returns 요약 결과
   */
  async processWithDenseSummary(
    transcripts: TranscriptLine[],
    callDate: string,
  ): Promise<DenseSummaryResult> {
    this.debug(`Starting dense summary processing: ${transcripts.length} lines`);

    // Step 1: LLM으로 요약 + 청크 생성
    const summaryResult =
      await this.summaryService.generateDenseSummaryWithChunks(
        transcripts,
        callDate,
      );

    this.debug(
      `✅ Summary generated: ${summaryResult.chunks.length} chunks, ${summaryResult.summaryText.length} chars`,
    );

    if (summaryResult.chunks.length === 0) {
      throw new Error('No chunks generated from summary');
    }

    return summaryResult;
  }

  /**
   * 문맥 청크 배열에 임베딩 생성 (배치 처리, 스트리밍)
   */
  async *embedContextualChunksInBatches(
    chunks: DenseSummaryResult['chunks'],
  ): AsyncGenerator<EmbeddedChunk[]> {
    const BATCH_SIZE = this.config.embeddingBatchSize;

    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
      const batch = chunks.slice(batchStart, batchEnd);
      const embeddedBatch: EmbeddedChunk[] = [];

      for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        try {
          // 헤더가 포함된 전체 텍스트로 임베딩 생성
          const embedding = await this.embeddingService.generateEmbedding(
            chunk.fullText,
          );
          embeddedBatch.push({
            chunk,
            embeddingStr: JSON.stringify(embedding),
            index: batchStart + i,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to embed chunk ${batchStart + i}: ${error.message}. Skipping.`,
          );
        }
      }

      if (embeddedBatch.length > 0) {
        yield embeddedBatch;
      }
    }
  }

  // ==========================================================================
  // v1: Raw 텍스트 처리 (Fallback)
  // ==========================================================================

  /**
   * v1: 원본 텍스트를 Parent-Child 청크로 변환 (Fallback용)
   *
   * Flow:
   * 1. 원본 대화를 Parent 청크로 분할
   * 2. 각 Parent를 Child 청크로 세분화
   * 3. Child 청크 임베딩 생성
   *
   * @param transcripts 원본 스크립트 배열
   * @returns Parent 청크 배열
   */
  async processWithRawTranscripts(
    transcripts: TranscriptLine[],
  ): Promise<ParentChunk[]> {
    this.debug(`Processing raw transcripts: ${transcripts.length} lines`);

    const parentChunks = this.chunkConversation(transcripts);

    this.debug(`✅ Created ${parentChunks.length} parent chunks`);

    return parentChunks;
  }

  /**
   * Parent 청크 하나를 처리: Child 청킹 + 임베딩
   *
   * @param parentChunk Parent 청크
   * @param wardId 어르신 ID
   * @param callId 통화 ID
   * @returns 임베딩된 Child 청크 배열 + 메타데이터
   */
  async processParentChunk(
    parentChunk: ParentChunk,
    wardId: string,
    callId: string,
  ): Promise<{
    parentTextWithDate: string;
    embeddedChildren: EmbeddedChildChunk[];
    metadata: ParentMetadata;
  }> {
    const transcripts = parentChunk.transcripts;

    // 통화 시작 시간 추출 및 KST 변환
    const callStartUtc = transcripts[0]?.timestamp
      ? new Date(transcripts[0].timestamp)
      : new Date();
    const callStartKst = toKST(callStartUtc);
    const datePrefix = `[날짜: ${formatKST(callStartKst)}]`;

    // 날짜 프리픽스 추가
    const parentTextWithDate = `${datePrefix} ${parentChunk.text}`;

    // 메타데이터 생성
    const metadata: ParentMetadata = {
      speakers: [...new Set(transcripts.map(t => t.speaker))],
      timestamp: transcripts[0]?.timestamp,
      callDate: callStartKst.toISOString(),
      callStartAt: callStartKst.toISOString(),
      parentLength: parentChunk.text.length,
      indexVersion: 'v1-raw',
    };

    // Child 청킹
    const childChunks = splitIntoChildChunks(
      parentTextWithDate,
      this.config.childChunkSize,
      this.config.childChunkOverlap,
    );

    if (childChunks.length === 0) {
      this.logger.warn(
        `No child chunks generated for call=${callId} ward=${wardId}`,
      );
      return { parentTextWithDate, embeddedChildren: [], metadata };
    }

    // Child 임베딩 생성
    const embeddedChildren = await this.embedRawChildChunks(
      childChunks,
      metadata,
    );

    this.debug(`✅ Processed parent: ${embeddedChildren.length} children`);

    return { parentTextWithDate, embeddedChildren, metadata };
  }

  /**
   * Raw Child 청크 배열에 임베딩 생성 (배치 처리)
   */
  private async embedRawChildChunks(
    childChunks: ChildChunk[],
    baseMetadata: ParentMetadata,
  ): Promise<EmbeddedChildChunk[]> {
    const embeddedChildren: EmbeddedChildChunk[] = [];
    const BATCH_SIZE = this.config.embeddingBatchSize;

    for (
      let batchStart = 0;
      batchStart < childChunks.length;
      batchStart += BATCH_SIZE
    ) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, childChunks.length);
      const batch = childChunks.slice(batchStart, batchEnd);

      for (const childChunk of batch) {
        try {
          const embedding = await this.embeddingService.generateEmbedding(
            childChunk.text,
          );
          const embeddingStr = JSON.stringify(embedding);
          const childMetadata = {
            ...baseMetadata,
            childLength: childChunk.text.length,
          };
          const metadataStr = JSON.stringify(childMetadata);

          embeddedChildren.push({
            chunk: childChunk,
            embeddingStr,
            metadataStr,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to embed raw child chunk: ${error.message}. Skipping.`,
          );
        }
      }
    }

    return embeddedChildren;
  }

  // ==========================================================================
  // 공통 유틸리티
  // ==========================================================================

  /**
   * 대화를 Parent 청크로 분할
   */
  private chunkConversation(transcripts: TranscriptLine[]): ParentChunk[] {
    const chunks: ParentChunk[] = [];
    let currentChunk: TranscriptLine[] = [];
    let currentLength = 0;
    const buildLineText = (t: TranscriptLine) => `[${t.speaker}]: ${t.text}`;

    for (const transcript of transcripts) {
      const lineText = buildLineText(transcript);
      const lineLength = lineText.length;

      if (
        currentLength + lineLength > this.config.chunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push({
          text: currentChunk.map(buildLineText).join('\n'),
          transcripts: currentChunk,
        });

        // Overlap 처리
        if (this.config.chunkOverlap > 0) {
          let overlapLength = 0;
          let overlapStart = currentChunk.length;
          while (overlapStart > 0 && overlapLength < this.config.chunkOverlap) {
            overlapStart -= 1;
            overlapLength += buildLineText(currentChunk[overlapStart]).length;
          }
          currentChunk = currentChunk.slice(overlapStart);
          currentLength = overlapLength;
        } else {
          currentChunk = [];
          currentLength = 0;
        }
      }

      currentChunk.push(transcript);
      currentLength += lineLength;
    }

    // 마지막 청크 추가
    if (currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.map(buildLineText).join('\n'),
        transcripts: currentChunk,
      });
    }

    return chunks;
  }

  /**
   * 통화 시작 시간 추출 및 날짜 문자열 생성
   */
  extractCallDateInfo(transcripts: TranscriptLine[]): {
    callStartKst: Date;
    callDateStr: string;
  } {
    const callStartUtc = transcripts[0]?.timestamp
      ? new Date(transcripts[0].timestamp)
      : new Date();
    const callStartKst = toKST(callStartUtc);
    const callDateStr = formatKST(callStartKst).split(' ')[0]; // YYYY-MM-DD

    return { callStartKst, callDateStr };
  }

  private debug(message: string): void {
    if (this.config.debugLogs) {
      this.logger.debug(message);
    }
  }
}
