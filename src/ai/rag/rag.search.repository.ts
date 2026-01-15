import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RagMetadata, SearchResult } from './rag.types';
import { getWindowContext } from './rag.utils';

/**
 * RAG Search Repository
 *
 * DB 검색 쿼리를 담당하는 레포지토리 레이어:
 * - Vector Search: pgvector 기반 유사도 검색
 * - Full-Text Search: PostgreSQL ts_rank 기반 키워드 검색
 * - SRP 원칙: 검색 쿼리만 담당
 */
@Injectable()
export class RagSearchRepository {
  private readonly logger = new Logger(RagSearchRepository.name);

  private readonly SIMILARITY_THRESHOLD = parseFloat(
    process.env.SIMILARITY_THRESHOLD || '0.4',
  );

  private readonly CHILD_SEARCH_MULTIPLIER = (() => {
    const value = parseInt(process.env.RAG_CHILD_SEARCH_MULTIPLIER || '3', 10);
    return Number.isFinite(value) && value > 0 ? value : 3;
  })();

  private readonly WINDOW_CONTEXT_CHARS = parseInt(
    process.env.RAG_WINDOW_CONTEXT_CHARS || '150',
    10,
  );

  private readonly DEBUG_LOGS = process.env.RAG_DEBUG_LOGS === 'true';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vector Search: pgvector 기반 유사도 검색
   *
   * Parent-Child 구조를 활용하여 검색:
   * 1. Child 벡터에서 유사도 검색
   * 2. Parent ID로 그룹화하여 중복 제거
   * 3. Parent 텍스트와 함께 반환
   */
  async searchVector(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      const embeddingStr = JSON.stringify(queryEmbedding);
      const expandedLimit = Math.max(
        limit,
        limit * this.CHILD_SEARCH_MULTIPLIER,
      );

      this.debug(
        `Vector search: ward=${wardId.substring(0, 8)}..., limit=${expandedLimit}`,
      );

      // Step 1: Child 벡터 검색 + Parent 조인
      const childResults = await this.prisma.$queryRaw<
        Array<{
          child_id: string;
          child_text: string;
          chunk_header: string | null;
          parent_id: string;
          parent_text: string;
          offset_start: number;
          offset_end: number;
          metadata: RagMetadata;
          similarity: number;
          created_at: Date;
          call_id: string;
        }>
      >(
        Prisma.sql`
          SELECT
            c.id AS child_id,
            c.child_text,
            c.chunk_header,
            c.parent_id,
            p.parent_text,
            c.offset_start,
            c.offset_end,
            c.metadata,
            1 - (c.embedding <=> ${embeddingStr}::vector) AS similarity,
            c.created_at,
            c.call_id
          FROM conversation_vectors_child c
          INNER JOIN conversation_vectors_parent p ON c.parent_id = p.id
          WHERE c.ward_id = ${wardId}::uuid
          ORDER BY c.embedding <=> ${embeddingStr}::vector
          LIMIT ${expandedLimit}
        `,
      );

      this.debug(
        `Found ${childResults.length} child results from vector search`,
      );

      // Step 2: 유사도 임계값 필터링
      const filtered = childResults.filter(
        r => r.similarity >= this.SIMILARITY_THRESHOLD,
      );

      if (filtered.length < childResults.length) {
        this.debug(
          `Filtered ${childResults.length - filtered.length} results below threshold ${this.SIMILARITY_THRESHOLD}`,
        );
      }

      // Step 3: Parent ID로 그룹화 (각 Parent당 가장 높은 유사도 Child만 선택)
      const groupedByParent = new Map<string, (typeof filtered)[0]>();

      for (const result of filtered) {
        const existing = groupedByParent.get(result.parent_id);
        if (!existing || result.similarity > existing.similarity) {
          groupedByParent.set(result.parent_id, result);
        }
      }

      // Step 4: 상위 N개 Parent 선택
      const uniqueParents = Array.from(groupedByParent.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      this.debug(
        `Grouped ${filtered.length} children into ${uniqueParents.length} unique parents`,
      );

      // Step 5: SearchResult 생성 (Parent 컨텍스트 + 스니펫)
      return uniqueParents.map(r => {
        const snippet = getWindowContext(
          r.parent_text,
          r.offset_start,
          r.offset_end,
          this.WINDOW_CONTEXT_CHARS,
        );

        // chunk_header를 metadata에 포함
        const metadata = {
          ...r.metadata,
          chunk_header: r.chunk_header || r.metadata?.chunk_header,
        };

        return {
          text: snippet || r.parent_text,
          childText: r.child_text,
          parentText: r.parent_text,
          parentId: r.parent_id,
          snippet: snippet,
          offsetStart: r.offset_start,
          offsetEnd: r.offset_end,
          metadata,
          similarity: r.similarity,
          createdAt: r.created_at.toISOString(),
          callId: r.call_id,
        };
      });
    } catch (error) {
      this.logger.error(`Vector search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Full-Text Search: ts_rank 기반 키워드 검색
   *
   * chunk_header(날짜, 관계 등)에 높은 가중치 부여:
   * - chunk_header: weight 'A' (1.0)
   * - child_text: weight 'C' (0.2)
   *
   * @param wardId 어르신 ID
   * @param keywords 검색 키워드 (공백으로 구분)
   * @param limit 반환할 최대 결과 수
   */
  async searchFullText(
    wardId: string,
    keywords: string,
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      if (!keywords || keywords.trim().length === 0) {
        this.debug('Empty keywords - skipping FTS');
        return [];
      }

      this.debug(
        `FTS search: ward=${wardId.substring(0, 8)}..., keywords="${keywords}", limit=${limit}`,
      );

      // 한글 복합어 지원을 위해 prefix 검색 사용
      // "병원 예약" → "병원:* | 예약:*" (OR: 하나라도 매칭되면 검색)
      const prefixKeywords = keywords
        .split(/\s+/)
        .filter(k => k.length > 0)
        .map(k => `${k}:*`)
        .join(' | ');

      this.debug(`FTS prefix query: "${prefixKeywords}"`);

      const results = await this.prisma.$queryRaw<
        Array<{
          child_id: string;
          child_text: string;
          chunk_header: string | null;
          parent_id: string;
          parent_text: string;
          offset_start: number;
          offset_end: number;
          metadata: RagMetadata;
          rank_score: number;
          created_at: Date;
          call_id: string;
        }>
      >(
        Prisma.sql`
          SELECT
            c.id AS child_id,
            c.child_text,
            c.chunk_header,
            c.parent_id,
            p.parent_text,
            c.offset_start,
            c.offset_end,
            c.metadata,
            ts_rank(c.fts_tokens, query) AS rank_score,
            c.created_at,
            c.call_id
          FROM conversation_vectors_child c
          INNER JOIN conversation_vectors_parent p ON c.parent_id = p.id,
          to_tsquery('simple', ${prefixKeywords}) query
          WHERE c.ward_id = ${wardId}::uuid
            AND c.fts_tokens @@ query
          ORDER BY rank_score DESC
          LIMIT ${limit}
        `,
      );

      this.debug(`Found ${results.length} results from FTS`);

      // SearchResult로 변환
      return results.map(r => {
        const snippet = getWindowContext(
          r.parent_text,
          r.offset_start,
          r.offset_end,
          this.WINDOW_CONTEXT_CHARS,
        );

        const metadata = {
          ...r.metadata,
          chunk_header: r.chunk_header || r.metadata?.chunk_header,
        };

        return {
          text: snippet || r.parent_text,
          childText: r.child_text,
          parentText: r.parent_text,
          parentId: r.parent_id,
          snippet: snippet,
          offsetStart: r.offset_start,
          offsetEnd: r.offset_end,
          metadata,
          similarity: r.rank_score, // FTS에서는 rank_score를 similarity로 사용
          createdAt: r.created_at.toISOString(),
          callId: r.call_id,
        };
      });
    } catch (error) {
      this.logger.error(
        `Full-text search failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private debug(message: string): void {
    if (this.DEBUG_LOGS) {
      this.logger.debug(message);
    }
  }
}
