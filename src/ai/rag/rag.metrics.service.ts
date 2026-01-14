import { Injectable, Logger } from '@nestjs/common';
import { PerformanceMetrics } from './rag.types';

/**
 * RAG Metrics Service
 *
 * Tracks performance metrics for RAG operations:
 * - Cache hit/miss rates
 * - Redis search response times
 * - PGVector search response times
 */
@Injectable()
export class RagMetricsService {
  private readonly logger = new Logger(RagMetricsService.name);

  private cacheHits = 0;
  private cacheMisses = 0;
  private pgvectorSearchTimes: number[] = [];
  private redisSearchTimes: number[] = [];

  /**
   * Record a cache hit with search time
   */
  recordCacheHit(searchTime: number): void {
    this.cacheHits++;
    this.redisSearchTimes.push(searchTime);
  }

  /**
   * Record a cache miss
   */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Record a PGVector search with response time
   */
  recordPgvectorSearch(searchTime: number): void {
    this.pgvectorSearchTimes.push(searchTime);
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const totalSearches = this.cacheHits + this.cacheMisses;
    const cacheHitRate =
      totalSearches > 0 ? (this.cacheHits / totalSearches) * 100 : 0;

    const avgRedisSearchTime =
      this.redisSearchTimes.length > 0
        ? this.redisSearchTimes.reduce((a, b) => a + b, 0) /
          this.redisSearchTimes.length
        : 0;

    const avgPgvectorSearchTime =
      this.pgvectorSearchTimes.length > 0
        ? this.pgvectorSearchTimes.reduce((a, b) => a + b, 0) /
          this.pgvectorSearchTimes.length
        : 0;

    return {
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      avgRedisSearchTime: Math.round(avgRedisSearchTime * 100) / 100,
      avgPgvectorSearchTime: Math.round(avgPgvectorSearchTime * 100) / 100,
      totalSearches,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.pgvectorSearchTimes = [];
    this.redisSearchTimes = [];
    this.logger.log('Performance metrics reset');
  }
}
