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

      // Calculate week ago in KST (UTC+9)
      const nowKST = new Date();
      nowKST.setHours(nowKST.getHours() + 9); // Convert to KST
      const weekAgoKST = new Date(nowKST);
      weekAgoKST.setDate(weekAgoKST.getDate() - this.WEEKLY_CONTEXT_DAYS);
      weekAgoKST.setHours(0, 0, 0, 0);

      this.logger.log(
        `Filtering by callDate >= ${weekAgoKST.toISOString()} (KST)`,
      );

      const vectors = await this.prisma.$queryRaw<
        Array<{
          id: string;
          chunk_text: string;
          embedding: string;
          metadata: any;
          created_at: Date;
          call_id: string;
        }>
      >(
        Prisma.sql`
          SELECT id, chunk_text, embedding::text, metadata, created_at, call_id
          FROM conversation_vectors
          WHERE ward_id = ${wardId}::uuid
            AND (metadata->>'callDate')::timestamp >= ${weekAgoKST}
          ORDER BY (metadata->>'callDate')::timestamp DESC
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
        `✅ Preloaded ${vectors.length} vectors for ward: ${wardId}`,
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
    if (!this.redisClient) return null;

    const cacheKey = this.getRedisVectorsKey(wardId);
    const cached = await this.redisClient.get(cacheKey);

    if (!cached) return null;

    const vectors: Array<{
      chunk_text: string;
      embedding: string;
      metadata: any;
      created_at: string;
      call_id: string;
    }> = JSON.parse(cached);

    const results: SearchResult[] = [];

    for (const vec of vectors) {
      try {
        const vecEmbedding: number[] = JSON.parse(vec.embedding);
        const similarity = cosineSimilarity(queryEmbedding, vecEmbedding);

        results.push({
          text: vec.chunk_text,
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

    return results.slice(0, limit);
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
            chunk_text: string;
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
              text: v.chunk_text,
              createdAt: new Date(v.created_at),
            }));
        }
      }

      // Fallback to PGVector
      this.logger.log(
        `Fetching recent context from PGVector for ward=${wardId}`,
      );

      const results = await this.prisma.$queryRaw<
        Array<{ chunk_text: string; created_at: Date }>
      >(
        Prisma.sql`
          SELECT chunk_text, created_at
          FROM conversation_vectors
          WHERE ward_id = ${wardId}::uuid
          ORDER BY created_at DESC
          LIMIT ${limit}
        `,
      );

      return results.map(r => ({
        text: r.chunk_text,
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
