import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  DenseSummaryResult,
  EmbeddedChunk,
  EmbeddedChildChunk,
  ParentMetadata,
  TranscriptLine,
} from './rag.types';
import { formatKST } from './rag.utils';

/**
 * RAG Repository Service
 *
 * DB 레이어를 담당하는 서비스입니다.
 * - Parent + Children 원자적 저장 (트랜잭션)
 * - v1 (Raw) 방식과 v2 (Dense Summary) 방식 모두 지원
 * - SQL Injection 방지: Prisma 템플릿 리터럴 사용
 */
@Injectable()
export class RagRepository {
  private readonly logger = new Logger(RagRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * v2: Dense Summary 방식으로 Parent + Children 저장
   *
   * @param wardId 어르신 ID
   * @param callId 통화 ID
   * @param summaryResult LLM 요약 결과
   * @param embeddedChunkBatches 임베딩된 청크 배치 스트림
   * @param callStartKst 통화 시작 시간 (KST)
   * @param transcripts 원본 스크립트 (백업용)
   * @returns 생성된 Parent ID
   */
  async saveWithDenseSummary(
    wardId: string,
    callId: string,
    summaryResult: DenseSummaryResult,
    embeddedChunkBatches: AsyncIterable<EmbeddedChunk[]>,
    callStartKst: Date,
    transcripts: TranscriptLine[],
  ): Promise<string> {
    // 원본 텍스트 (Fallback 참조용)
    const originalText = transcripts
      .map(t => `[${t.speaker}]: ${t.text}`)
      .join('\n');

    // 요약본에 날짜 프리픽스 추가
    const datePrefix = `[날짜: ${formatKST(callStartKst)}]`;
    const summaryTextWithDate = `${datePrefix} ${summaryResult.summaryText}`;

    // Parent 메타데이터
    const parentMetadata: ParentMetadata = {
      speakers: [...new Set(transcripts.map(t => t.speaker))],
      timestamp: transcripts[0]?.timestamp,
      callDate: callStartKst.toISOString(),
      callStartAt: callStartKst.toISOString(),
      topics: summaryResult.metadata.topics,
      keywords: summaryResult.metadata.keywords,
      originalLength: summaryResult.metadata.originalLength,
      summaryLength: summaryResult.metadata.summaryLength,
      chunkCount: summaryResult.metadata.chunkCount,
      indexVersion: 'v2-dense-summary',
    };

    let parentId: string | null = null;
    let insertedChildren = 0;

    await this.prisma.$transaction(async tx => {
      const parentMetadataStr = JSON.stringify(parentMetadata);

      // Parent 삽입 (요약본 + 원본 저장)
      const parentResult = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          INSERT INTO conversation_vectors_parent (
            ward_id, call_id, parent_text, summary_text, metadata
          )
          VALUES (
            ${wardId}::uuid,
            ${callId}::uuid,
            ${originalText},
            ${summaryTextWithDate},
            ${parentMetadataStr}::jsonb
          )
          RETURNING id
        `,
      );

      parentId = parentResult[0]?.id;
      if (!parentId) {
        throw new Error('Failed to get parent ID after insert');
      }

      // Children 삽입 (배치 처리)
      for await (const batch of embeddedChunkBatches) {
        if (batch.length === 0) {
          continue;
        }

        insertedChildren += batch.length;

        const values = batch.map(row => {
          const childMetadata = {
            ...parentMetadata,
            chunkIndex: row.index,
            header: row.chunk.header,
            contentLength: row.chunk.content.length,
          };
          const metadataStr = JSON.stringify(childMetadata);

          // offset은 청크 순서 기준으로 대략 계산
          const offsetStart = row.index * 150;
          const offsetEnd = offsetStart + row.chunk.fullText.length;

          return Prisma.sql`(
            ${parentId}::uuid,
            ${wardId}::uuid,
            ${callId}::uuid,
            ${row.chunk.fullText},
            ${row.chunk.header},
            ${row.embeddingStr}::vector,
            ${offsetStart},
            ${offsetEnd},
            ${metadataStr}::jsonb
          )`;
        });

        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO conversation_vectors_child (
              parent_id, ward_id, call_id, child_text, chunk_header, embedding,
              offset_start, offset_end, metadata
            )
            VALUES ${Prisma.join(values)}
          `,
        );
      }

      if (insertedChildren === 0) {
        throw new Error('No embedded chunks to save');
      }
    });

    this.logger.debug(
      `✅ Saved Dense Summary: parentId=${parentId}, ${insertedChildren} children`,
    );

    return parentId!;
  }

  /**
   * v1: Raw 방식으로 Parent + Children 저장
   *
   * @param wardId 어르신 ID
   * @param callId 통화 ID
   * @param parentTextWithDate 날짜 프리픽스가 포함된 Parent 텍스트
   * @param embeddedChildren 임베딩된 Child 청크 배열
   * @param metadata Parent 메타데이터
   * @returns 생성된 Parent ID
   */
  async saveWithRawChunks(
    wardId: string,
    callId: string,
    parentTextWithDate: string,
    embeddedChildren: EmbeddedChildChunk[],
    metadata: ParentMetadata,
  ): Promise<string> {
    let parentId: string | null = null;

    await this.prisma.$transaction(async tx => {
      const metadataStr = JSON.stringify(metadata);

      // Parent 삽입
      const parentResult = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          INSERT INTO conversation_vectors_parent (ward_id, call_id, parent_text, metadata)
          VALUES (
            ${wardId}::uuid,
            ${callId}::uuid,
            ${parentTextWithDate},
            ${metadataStr}::jsonb
          )
          RETURNING id
        `,
      );

      parentId = parentResult[0]?.id ?? null;
      if (!parentId) {
        throw new Error('Failed to get parent ID after insert');
      }

      // Children 삽입 (배치 처리)
      const BATCH_SIZE = 50;
      for (
        let batchStart = 0;
        batchStart < embeddedChildren.length;
        batchStart += BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + BATCH_SIZE,
          embeddedChildren.length,
        );
        const batch = embeddedChildren.slice(batchStart, batchEnd);

        const values = batch.map(row => {
          return Prisma.sql`(
            ${parentId}::uuid,
            ${wardId}::uuid,
            ${callId}::uuid,
            ${row.chunk.text},
            ${row.embeddingStr}::vector,
            ${row.chunk.offsetStart},
            ${row.chunk.offsetEnd},
            ${row.metadataStr}::jsonb
          )`;
        });

        await tx.$executeRaw(
          Prisma.sql`
            INSERT INTO conversation_vectors_child (
              parent_id, ward_id, call_id, child_text, embedding,
              offset_start, offset_end, metadata
            )
            VALUES ${Prisma.join(values)}
          `,
        );
      }
    });

    this.logger.debug(
      `✅ Saved Raw chunks: parentId=${parentId}, ${embeddedChildren.length} children`,
    );

    return parentId!;
  }

  /**
   * 특정 통화의 인덱싱 데이터 존재 여부 확인
   */
  async hasIndexedData(callId: string): Promise<boolean> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) as count
        FROM conversation_vectors_parent
        WHERE call_id = ${callId}::uuid
      `,
    );
    return Number(result[0]?.count) > 0;
  }

  /**
   * 특정 통화의 인덱싱 데이터 삭제 (재인덱싱용)
   */
  async deleteIndexedData(callId: string): Promise<number> {
    // Children은 CASCADE로 자동 삭제됨
    const result = await this.prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM conversation_vectors_parent
        WHERE call_id = ${callId}::uuid
      `,
    );
    return result;
  }
}
