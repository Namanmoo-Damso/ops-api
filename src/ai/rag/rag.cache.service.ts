import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { createClient, type RedisClientType } from 'redis';
import { SearchResult, ContextResult } from './rag.types';
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
  private readonly CACHE_VERSION = 'v1';

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
      // Use UTC timestamps to match database metadata.callStartAt
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - this.WEEKLY_CONTEXT_DAYS);

      this.logger.log(
        `Filtering conversations that occurred after ${weekAgo.toISOString()} (${this.WEEKLY_CONTEXT_DAYS} days ago)`,
      );

      // Fetch from conversation_vectors_child (Parent-Child structure)
      // Child has embeddings for search, parent has full context
      // IMPORTANT: Filter by actual conversation time (callStartAt), not vector creation time (created_at)
      const vectors = await this.prisma.$queryRaw<
        Array<{
          id: string;
          child_text: string;
          embedding: string;
          metadata: any;
          created_at: Date;
          call_id: string;
          parent_id: string;
        }>
      >(
        Prisma.sql`
          SELECT
            c.id,
            c.child_text,
            c.embedding::text,
            c.metadata,
            c.created_at,
            c.call_id,
            c.parent_id
          FROM conversation_vectors_child c
          WHERE c.ward_id = ${wardId}::uuid
            AND (c.metadata->>'callStartAt')::timestamp >= ${weekAgo}
          ORDER BY (c.metadata->>'callStartAt')::timestamp DESC
        `,
      );

      if (vectors.length === 0) {
        this.logger.log(`No weekly context found for ward: ${wardId}`);
        return;
      }

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

    const cacheKey = this.getRedisVectorsKey(wardId);
    this.logger.debug(`Checking cache key: ${cacheKey}`);

    const cached = await this.redisClient.get(cacheKey);

    if (!cached) {
      this.logger.debug(`Cache key not found: ${cacheKey}`);
      return null;
    }

    const vectors: Array<{
      child_text: string;
      embedding: string;
      metadata: any;
      created_at: string;
      call_id: string;
      parent_id: string;
    }> = JSON.parse(cached);

    this.logger.debug(
      `Found ${vectors.length} cached vectors for ward=${wardId.substring(0, 8)}...`,
    );

    const results: SearchResult[] = [];

    for (const vec of vectors) {
      try {
        const vecEmbedding: number[] = JSON.parse(vec.embedding);
        const similarity = cosineSimilarity(queryEmbedding, vecEmbedding);

        results.push({
          text: vec.child_text,
          metadata: vec.metadata,
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

    this.logger.debug(
      `Returning top ${filteredResults.length} results (max similarity: ${filteredResults[0]?.similarity.toFixed(3) || 'N/A'})`,
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
        const cacheKey = this.getRedisVectorsKey(wardId);
        const cached = await this.redisClient.get(cacheKey);

        if (cached) {
          this.logger.log(
            `✅ Redis cache HIT for recent context: ward=${wardId}`,
          );
          const vectors: Array<{
            child_text: string;
            created_at: string;
          }> = JSON.parse(cached);

          return vectors
            .sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            )
            .slice(0, limit)
            .map(v => ({
              text: v.child_text,
              createdAt: new Date(v.created_at),
            }));
        }
      }

      // Fallback to PGVector (use child table)
      this.logger.log(
        `Fetching recent context from PGVector for ward=${wardId}`,
      );

      const results = await this.prisma.$queryRaw<
        Array<{ child_text: string; created_at: Date }>
      >(
        Prisma.sql`
          SELECT child_text, created_at
          FROM conversation_vectors_child
          WHERE ward_id = ${wardId}::uuid
            AND (metadata->>'callDate')::timestamp >= NOW() - INTERVAL '7 days'
          ORDER BY created_at DESC
          LIMIT ${limit}
        `,
      );

      return results.map(r => ({
        text: r.child_text,
        createdAt: r.created_at,
      }));
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
    return `rag:${this.CACHE_VERSION}:ward:${wardId}:vectors`;
  }

  /**
   * Get greeting cache key
   */
  getGreetingCacheKey(wardId: string): string {
    return `rag:${this.CACHE_VERSION}:ward:${wardId}:greeting`;
  }

  /**
   * Get Redis client (for greeting generator)
   */
  getRedisClient(): RedisClientType | null {
    return this.redisClient;
  }
}
