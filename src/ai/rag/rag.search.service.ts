import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { SearchResult } from './rag.types';
import { getWindowContext } from './rag.utils';

/**
 * RAG Search Service
 *
 * Handles PGVector search operations with Parent-Child structure:
 * - Searches child vectors for similarity matching
 * - Groups results by parent_id
 * - Returns parent context with window snippets
 */
@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  private readonly SIMILARITY_THRESHOLD = parseFloat(
    process.env.SIMILARITY_THRESHOLD || '0.0',
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
   * Search PGVector for similar conversations using Parent-Child structure
   *
   * Strategy:
   * 1. Search child vectors for similarity
   * 2. Group by parent_id to avoid duplicate contexts
   * 3. Fetch parent text for each matched parent
   * 4. Return window context around child match
   */
  async searchPGVector(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      const embeddingStr = JSON.stringify(queryEmbedding);
      const expandedLimit = Math.max(limit, limit * this.CHILD_SEARCH_MULTIPLIER);
      this.debug(
        `Executing PGVector query: ward=${wardId.substring(0, 8)}..., limit=${expandedLimit}`,
      );

      // Step 1: Search child vectors and join with parent
      const childResults = await this.prisma.$queryRaw<
        Array<{
          child_id: string;
          child_text: string;
          parent_id: string;
          parent_text: string;
          offset_start: number;
          offset_end: number;
          metadata: any;
          similarity: number;
          created_at: Date;
          call_id: string;
        }>
      >(
        Prisma.sql`
          SELECT
            c.id AS child_id,
            c.child_text,
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
        `Found ${childResults.length} child results from PGVector`,
      );

      // Filter by similarity threshold
      const filtered = childResults.filter(
        r => r.similarity >= this.SIMILARITY_THRESHOLD,
      );

      if (filtered.length < childResults.length) {
        this.debug(
          `Filtered ${childResults.length - filtered.length} child results below threshold ${this.SIMILARITY_THRESHOLD}`,
        );
      }

      // Step 2: Group by parent_id (take highest similarity child per parent)
      const groupedByParent = new Map<string, (typeof filtered)[0]>();

      for (const result of filtered) {
        const existing = groupedByParent.get(result.parent_id);
        if (!existing || result.similarity > existing.similarity) {
          groupedByParent.set(result.parent_id, result);
        }
      }

      // Step 3: Take top N unique parents
      const uniqueParents = Array.from(groupedByParent.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      this.debug(
        `Grouped ${filtered.length} child results into ${uniqueParents.length} unique parents`,
      );

      if (uniqueParents.length > 0) {
        this.debug(
          `Top result: similarity=${uniqueParents[0].similarity.toFixed(3)}, text="${uniqueParents[0].child_text.substring(0, 50)}..."`,
        );
      }

      // Step 4: Build SearchResult with parent context and snippet
      return uniqueParents.map(r => {
        // Generate window context around the child chunk
        const snippet = getWindowContext(
          r.parent_text,
          r.offset_start,
          r.offset_end,
          this.WINDOW_CONTEXT_CHARS,
        );

        return {
          text: snippet || r.parent_text, // Use snippet if available, fallback to full parent
          childText: r.child_text,
          parentText: r.parent_text,
          parentId: r.parent_id,
          snippet: snippet,
          offsetStart: r.offset_start,
          offsetEnd: r.offset_end,
          metadata: r.metadata,
          similarity: r.similarity,
          createdAt: r.created_at.toISOString(),
          callId: r.call_id,
        };
      });
    } catch (error) {
      this.logger.error(
        `PGVector search failed: ${error.message}`,
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
