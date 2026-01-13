import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { SearchResult } from './rag.types';

/**
 * RAG Search Service
 *
 * Handles PGVector search operations:
 * - Searches for similar conversation vectors
 * - Filters results by similarity threshold
 */
@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  private readonly SIMILARITY_THRESHOLD = parseFloat(
    process.env.SIMILARITY_THRESHOLD || '0.0',
  );

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Search PGVector for similar conversations
   */
  async searchPGVector(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      const embeddingStr = JSON.stringify(queryEmbedding);

      const results = await this.prisma.$queryRaw<
        Array<{
          chunk_text: string;
          metadata: any;
          similarity: number;
          created_at: Date;
          call_id: string;
        }>
      >(
        Prisma.sql`
          SELECT 
            chunk_text,
            metadata,
            1 - (embedding <=> ${embeddingStr}::vector) AS similarity,
            created_at,
            call_id
          FROM conversation_vectors
          WHERE ward_id = ${wardId}::uuid
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT ${limit}
        `,
      );

      // Filter by similarity threshold
      const filtered = results.filter(
        r => r.similarity >= this.SIMILARITY_THRESHOLD,
      );

      if (filtered.length < results.length) {
        this.logger.debug(
          `Filtered ${results.length - filtered.length} PGVector results below threshold ${this.SIMILARITY_THRESHOLD}`,
        );
      }

      return filtered.map(r => ({
        text: r.chunk_text,
        metadata: r.metadata,
        similarity: r.similarity,
        createdAt: r.created_at.toISOString(),
        callId: r.call_id,
      }));
    } catch (error) {
      this.logger.error(`PGVector search failed: ${error.message}`);
      throw error;
    }
  }
}
