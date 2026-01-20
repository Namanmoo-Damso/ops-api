import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { createClient, type RedisClientType } from 'redis';
import { ContextResult, RagMetadata, SearchResult } from './rag.types';
import { cosineSimilarity } from './rag.utils';

/**
 * RAG Cache Service
 *
 * Manages Redis cache for RAG operations:
 * - Preloads weekly context into Redis
 * - Searches Redis cache for fast lookups
 * - Manages cache keys and TTL
 */
@Injectable()
export class RagCacheService implements OnModuleInit {
  private readonly logger = new Logger(RagCacheService.name);
  private redisClient: RedisClientType | null = null;

  private readonly REDIS_CACHE_TTL = parseInt(
    process.env.REDIS_CACHE_TTL || '3600',
    10,
  );
  private readonly WEEKLY_CONTEXT_DAYS = parseInt(
    process.env.WEEKLY_CONTEXT_DAYS || '7',
    10,
  );
  private readonly VECTOR_CACHE_VERSION = 'v2';
  private readonly GREETING_CACHE_VERSION = 'v1';
  private readonly EMBEDDING_CACHE_TTL = 7 * 24 * 3600; // 7 days

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error(
        'REDIS_URL is required for RAG service (cache + greetings)',
      );
    }

    try {
      this.redisClient = createClient({ url: redisUrl });
      await this.redisClient.connect();
      this.logger.log('Redis connected for RAG vector cache');
    } catch (error) {
      throw new Error(`Redis connection failed: ${error.message}`);
    }
  }

  /**
   * Preload weekly context into Redis
   */
  async preloadWeeklyContext(wardId: string): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn('Redis not available - skipping context preload');
      return;
    }

    try {
      this.logger.log(`Preloading weekly context for ward: ${wardId}`);

      // Calculate week ago threshold (7 days from now)
      // Use UTC timestamps to match database metadata.callDate or callStartAt
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - this.WEEKLY_CONTEXT_DAYS);

      this.logger.log(
        `Filtering conversations that occurred after ${weekAgo.toISOString()} (${this.WEEKLY_CONTEXT_DAYS} days ago)`,
      );

      // Fetch from conversation_vectors_child (Parent-Child structure)
      // v2: Include chunk_header for better search quality
      // Filter by callDate (primary) or callStartAt (fallback) from metadata
      const vectors = await this.prisma.$queryRaw<
        Array<{
          id: string;
          child_text: string;
          chunk_header: string | null;
          embedding: string;
          metadata: RagMetadata;
          created_at: Date;
          call_id: string;
          parent_id: string;
        }>
      >(
        Prisma.sql`
          SELECT
            c.id,
            c.child_text,
            c.chunk_header,
            c.embedding::text,
            c.metadata,
            c.created_at,
            c.call_id,
            c.parent_id
          FROM conversation_vectors_child c
          WHERE c.ward_id = ${wardId}::uuid
            AND (
              -- v2: Use callDate if available, fallback to callStartAt
              COALESCE(
                (c.metadata->>'callDate')::timestamp,
                (c.metadata->>'callStartAt')::timestamp
              ) >= ${weekAgo}
            )
          ORDER BY COALESCE(
            (c.metadata->>'callDate')::timestamp,
            (c.metadata->>'callStartAt')::timestamp
          ) DESC
        `,
      );

      if (vectors.length === 0) {
        this.logger.log(`No weekly context found for ward: ${wardId}`);
        return;
      }

      // Log metadata stats for debugging
      const v2Count = vectors.filter(
        v => v.metadata?.indexVersion === 'v2-dense-summary',
      ).length;
      const withHeaders = vectors.filter(v => v.chunk_header).length;

      this.logger.log(
        `Preload stats: total=${vectors.length}, v2=${v2Count}, with_headers=${withHeaders}`,
      );

      const cacheKey = this.getRedisVectorsKey(wardId);
      const cacheData = JSON.stringify(vectors);

      await this.redisClient.setEx(cacheKey, this.REDIS_CACHE_TTL, cacheData);

      this.logger.log(
        `✅ Preloaded ${vectors.length} vectors for ward: ${wardId} (conversations from last ${this.WEEKLY_CONTEXT_DAYS} days)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to preload weekly context: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Search Redis cache for similar vectors
   */
  async searchRedisCache(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SearchResult[] | null> {
    if (!this.redisClient) {
      this.logger.debug('Redis client not available');
      return null;
    }

    const cached = await this.getCachedVectors(wardId);
    if (!cached) {
      return null;
    }

    const vectors: Array<{
      child_text?: string;
      chunk_text?: string;
      chunk_header?: string | null;
      embedding: string;
      metadata: RagMetadata;
      created_at: string;
      call_id: string;
      parent_id?: string;
    }> = cached.vectors as Array<{
      child_text?: string;
      chunk_text?: string;
      chunk_header?: string | null;
      embedding: string;
      metadata: RagMetadata;
      created_at: string;
      call_id: string;
      parent_id?: string;
    }>;

    this.logger.debug(
      `Found ${vectors.length} cached vectors for ward=${wardId.substring(0, 8)}...`,
    );

    const results: SearchResult[] = [];

    for (const vec of vectors) {
      try {
        const text = vec.child_text ?? vec.chunk_text;
        if (!text) {
          continue;
        }
        const vecEmbedding: number[] = JSON.parse(vec.embedding);
        const similarity = cosineSimilarity(queryEmbedding, vecEmbedding);

        // v2: Include chunk_header in search results for better context
        // chunk_header format: [YYYY-MM-DD | 주제 | 키워드1, 키워드2]
        const chunkHeader = vec.chunk_header || vec.metadata?.header;

        results.push({
          text,
          metadata: {
            ...vec.metadata,
            // Ensure chunk_header is in metadata for consistency
            chunk_header: chunkHeader,
          },
          similarity,
          createdAt: vec.created_at,
          callId: vec.call_id,
        });
      } catch (error) {
        this.logger.warn(`Failed to parse vector embedding: ${error.message}`);
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    const topResults = results.slice(0, limit);

    // IMPORTANT: Apply similarity threshold
    // If all results are below threshold, return empty array to trigger PGVector fallback
    const SIMILARITY_THRESHOLD = parseFloat(
      process.env.SIMILARITY_THRESHOLD || '0.0',
    );

    const filteredResults = topResults.filter(
      r => r.similarity >= SIMILARITY_THRESHOLD,
    );

    if (filteredResults.length === 0 && topResults.length > 0) {
      this.logger.warn(
        `All ${topResults.length} cached results below similarity threshold ${SIMILARITY_THRESHOLD} (max: ${topResults[0].similarity.toFixed(3)}) - returning empty to trigger PGVector fallback`,
      );
      return [];
    }

    // Log v2 stats for monitoring
    const v2Results = filteredResults.filter(
      r => r.metadata?.indexVersion === 'v2-dense-summary',
    );
    const withHeaders = filteredResults.filter(r => r.metadata?.chunk_header);

    this.logger.debug(
      `Returning top ${filteredResults.length} results (v2=${v2Results.length}, with_headers=${withHeaders.length}, max similarity: ${filteredResults[0]?.similarity.toFixed(3) || 'N/A'})`,
    );

    return filteredResults;
  }

  /**
   * Get recent context from cache or database
   */
  async getRecentContext(
    wardId: string,
    limit: number = 10,
  ): Promise<ContextResult[]> {
    try {
      // Try Redis cache first
      if (this.redisClient) {
        const cached = await this.getCachedVectors(wardId);
        if (cached) {
          this.logger.log(
            `✅ Redis cache HIT for recent context: ward=${wardId}`,
          );
          const vectors: Array<{
            child_text?: string;
            chunk_text?: string;
            chunk_header?: string | null;
            created_at: string;
            metadata?: RagMetadata;
          }> = cached.vectors as Array<{
            child_text?: string;
            chunk_text?: string;
            chunk_header?: string | null;
            created_at: string;
            metadata?: RagMetadata;
          }>;

          return vectors
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            )
            .slice(0, limit)
            .map(v => {
              const text = v.child_text ?? v.chunk_text;
              if (!text) {
                return null;
              }
              // v2: Include chunk_header for better context display
              const header = v.chunk_header || v.metadata?.header;
              const displayText = header ? `${header} ${text}` : text;

              return {
                text: displayText,
                createdAt: new Date(v.created_at),
              };
            })
            .filter((v): v is ContextResult => v !== null);
        }
      }

      // Fallback to PGVector (use child table)
      this.logger.log(
        `Fetching recent context from PGVector for ward=${wardId}`,
      );

      const results = await this.prisma.$queryRaw<
        Array<{
          child_text: string;
          chunk_header: string | null;
          created_at: Date;
        }>
      >(
        Prisma.sql`
          SELECT child_text, chunk_header, created_at
          FROM conversation_vectors_child
          WHERE ward_id = ${wardId}::uuid
            AND (
              COALESCE(
                (metadata->>'callDate')::timestamp,
                (metadata->>'callStartAt')::timestamp
              ) >= NOW() - INTERVAL '7 days'
            )
          ORDER BY created_at DESC
          LIMIT ${limit}
        `,
      );

      return results.map(r => {
        const displayText = r.chunk_header
          ? `${r.chunk_header} ${r.child_text}`
          : r.child_text;
        return {
          text: displayText,
          createdAt: r.created_at,
        };
      });
    } catch (error) {
      this.logger.error(
        `Failed to get recent context: ${error.message}`,
        error.stack,
      );
      return [];
    }
  }

  /**
   * Get Redis vectors cache key
   */
  getRedisVectorsKey(wardId: string): string {
    return `rag:${this.VECTOR_CACHE_VERSION}:ward:${wardId}:vectors`;
  }

  /**
   * Get greeting cache key
   */
  getGreetingCacheKey(wardId: string): string {
    return `rag:${this.GREETING_CACHE_VERSION}:ward:${wardId}:greeting`;
  }

  /**
   * Get global embedding cache key (model-aware)
   */
  getGlobalEmbeddingKey(hash: string, model: string): string {
    return `rag:${this.VECTOR_CACHE_VERSION}:global:vectors:${model}:${hash}`;
  }

  /**
   * Get user embedding cache key (model-aware)
   */
  getUserEmbeddingKey(wardId: string, hash: string, model: string): string {
    return `rag:${this.VECTOR_CACHE_VERSION}:user:${wardId}:vectors:${model}:${hash}`;
  }

  /**
   * Read embedding from global cache
   */
  async getGlobalCachedEmbedding(
    hash: string,
    model: string,
  ): Promise<number[] | null> {
    if (!this.redisClient) return null;
    const key = this.getGlobalEmbeddingKey(hash, model);
    return this.getCachedEmbedding(key, model);
  }

  /**
   * Read embedding from user cache
   */
  async getUserCachedEmbedding(
    wardId: string,
    hash: string,
    model: string,
  ): Promise<number[] | null> {
    if (!this.redisClient) return null;
    const key = this.getUserEmbeddingKey(wardId, hash, model);
    return this.getCachedEmbedding(key, model);
  }

  /**
   * Write embedding to global cache
   */
  async setGlobalCachedEmbedding(
    hash: string,
    model: string,
    embedding: number[],
    text?: string,
  ): Promise<void> {
    if (!this.redisClient) return;
    const key = this.getGlobalEmbeddingKey(hash, model);
    await this.redisClient.setEx(
      key,
      this.EMBEDDING_CACHE_TTL,
      this.serializeEmbedding(embedding, model, text),
    );
  }

  /**
   * Write embedding to user cache
   */
  async setUserCachedEmbedding(
    wardId: string,
    hash: string,
    model: string,
    embedding: number[],
    text?: string,
  ): Promise<void> {
    if (!this.redisClient) return;
    const key = this.getUserEmbeddingKey(wardId, hash, model);
    await this.redisClient.setEx(
      key,
      this.EMBEDDING_CACHE_TTL,
      this.serializeEmbedding(embedding, model, text),
    );
  }

  /**
   * Get Redis client (for greeting generator)
   */
  getRedisClient(): RedisClientType | null {
    return this.redisClient;
  }

  /**
   * Get cached vectors from Redis (internal use)
   */
  private async getCachedVectors(
    wardId: string,
  ): Promise<{ key: string; vectors: unknown[] } | null> {
    if (!this.redisClient) {
      return null;
    }

    const primaryKey = this.getRedisVectorsKey(wardId);
    this.logger.debug(`Checking cache key: ${primaryKey}`);
    const primary = await this.redisClient.get(primaryKey);

    if (primary) {
      try {
        const parsed = JSON.parse(primary);
        if (!Array.isArray(parsed)) {
          this.logger.warn(
            `Invalid cached vectors payload for key=${primaryKey}`,
          );
          return null;
        }
        return { key: primaryKey, vectors: parsed };
      } catch (error) {
        this.logger.warn(
          `Failed to parse cached vectors for key=${primaryKey}: ${error.message}`,
        );
        return null;
      }
    }

    this.logger.debug(`Cache key not found: ${primaryKey}`);
    return null;
  }

  /**
   * Serialize embedding payload with model versioning
   */
  private serializeEmbedding(
    embedding: number[],
    model: string,
    text?: string,
  ): string {
    return JSON.stringify({ text: text ?? null, model, embedding });
  }

  /**
   * Parse embedding payload with model check
   */
  private async getCachedEmbedding(
    key: string,
    model: string,
  ): Promise<number[] | null> {
    if (!this.redisClient) {
      return null;
    }

    const cached = await this.redisClient.get(key);
    if (!cached) {
      return null;
    }

    try {
      const parsed = JSON.parse(cached) as {
        model?: string;
        embedding?: unknown;
      };
      if (parsed.model !== model) {
        return null;
      }
      if (!Array.isArray(parsed.embedding)) {
        return null;
      }
      return parsed.embedding as number[];
    } catch (error) {
      this.logger.warn(
        `Failed to parse cached embedding for key=${key}: ${error.message}`,
      );
      return null;
    }
  }
}
