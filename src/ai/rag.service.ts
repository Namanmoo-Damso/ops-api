import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { GreetingGenerator } from './rag.greeting';
import { TranscriptLine } from './rag.chunks';
import { toKST, formatKST } from './rag/rag.utils';
import { RagEmbeddingService } from './rag/rag.embedding.service';
import { RagSearchService } from './rag/rag.search.service';
import { RagCacheService } from './rag/rag.cache.service';
import { RagMetricsService } from './rag/rag.metrics.service';
import {
  SearchResult,
  ContextResult,
  PerformanceMetrics,
} from './rag/rag.types';

/**
 * RAG Service - Main Orchestrator
 *
 * Coordinates between specialized services:
 * - RagEmbeddingService: Generates embeddings
 * - RagSearchService: Searches PGVector
 * - RagCacheService: Manages Redis cache
 * - RagMetricsService: Tracks performance
 *
 * Architecture:
 * - Storage: PGVector (permanent storage for all conversation vectors)
 * - Embeddings: AWS Bedrock Titan Embeddings V2 (1024 dimensions)
 * - Cache: Redis (7-day rolling window for fast access)
 * - Search: Hybrid (Redis cache → PGVector fallback)
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private greetingGenerator: GreetingGenerator | null = null;

  // Configuration
  private readonly LLM_MODEL =
    process.env.BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
  private readonly SEARCH_LIMIT = parseInt(
    process.env.RAG_SEARCH_LIMIT || '5',
    10,
  );
  private readonly CHUNK_SIZE = parseInt(
    process.env.RAG_CHUNK_SIZE || '500',
    10,
  );
  private readonly CHUNK_OVERLAP = parseInt(
    process.env.RAG_CHUNK_OVERLAP || '50',
    10,
  );
  private readonly MAX_CONTEXT_CHARS = 3000;
  private readonly MAX_GREETING_TOKENS = 200;
  private readonly REDIS_GREETING_TTL = parseInt(
    process.env.REDIS_GREETING_TTL || '600',
    10,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: RagEmbeddingService,
    private readonly searchService: RagSearchService,
    private readonly cacheService: RagCacheService,
    private readonly metricsService: RagMetricsService,
  ) {}

  async onModuleInit() {
    // Initialize greeting generator
    const redisClient = this.cacheService.getRedisClient();

    this.greetingGenerator = new GreetingGenerator(
      {
        logger: this.logger,
        // Use lazy getter to avoid module initialization order issues
        bedrockClient: () => this.embeddingService.getBedrockClient(),
        redisClient,
        getRecentContext: (wardId: string, limit?: number) =>
          this.getRecentContext(wardId, limit),
        getGreetingCacheKey: (wardId: string) =>
          this.cacheService.getGreetingCacheKey(wardId),
      },
      {
        llmModel: this.LLM_MODEL,
        maxContextChars: this.MAX_CONTEXT_CHARS,
        maxGreetingTokens: this.MAX_GREETING_TOKENS,
        redisGreetingTTL: this.REDIS_GREETING_TTL,
      },
    );

    this.logger.log('RAG Service initialized (orchestrator mode)');
  }

  /**
   * Index conversation from a call
   */
  async indexConversation(
    callId: string,
    wardId: string,
    transcripts: TranscriptLine[],
  ): Promise<void> {
    if (!callId || !wardId) {
      throw new BadRequestException('callId and wardId are required');
    }

    try {
      this.logger.log(
        `Indexing conversation: callId=${callId}, wardId=${wardId}, transcripts=${transcripts.length}`,
      );

      // Chunk the conversation
      const chunks = this.chunkConversation(transcripts);
      this.logger.log(`Created ${chunks.length} chunks for indexing`);

      // Index each chunk
      const indexPromises = chunks.map(chunk =>
        this.indexChunk(wardId, callId, chunk.text, chunk.transcripts),
      );

      const results = await Promise.allSettled(indexPromises);
      const failures = results
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.status === 'rejected');
      const successCount = results.length - failures.length;

      if (failures.length > 0) {
        this.logger.warn(
          `⚠️ Indexed ${successCount}/${chunks.length} chunks for call: ${callId}. ${failures.length} failed.`,
        );

        for (const failure of failures) {
          const reason = (failure.result as PromiseRejectedResult).reason;
          const message =
            reason instanceof Error ? reason.message : String(reason);
          const stack = reason instanceof Error ? reason.stack : undefined;
          this.logger.error(
            `Chunk ${failure.index + 1}/${chunks.length} failed to index: ${message}`,
            stack,
          );
        }

        if (successCount === 0) {
          throw new Error(
            `Failed to index conversation ${callId}: all chunks failed`,
          );
        }
      } else {
        this.logger.log(
          `✅ Indexed ${chunks.length} chunks for call: ${callId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to index conversation: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Preload weekly context into Redis
   */
  async preloadWeeklyContext(wardId: string): Promise<void> {
    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    return this.cacheService.preloadWeeklyContext(wardId);
  }

  /**
   * Search for relevant conversation context
   */
  async searchSimilar(
    wardId: string,
    query: string,
    limit?: number,
  ): Promise<SearchResult[]> {
    if (!wardId || !query) {
      throw new BadRequestException('wardId and query are required');
    }

    try {
      const searchLimit = limit || this.SEARCH_LIMIT;

      // Generate query embedding
      const queryEmbedding =
        await this.embeddingService.generateEmbedding(query);

      // 🚀 Try Redis cache first (FAST PATH)
      const redisStartTime = Date.now();
      const cached = await this.cacheService.searchRedisCache(
        wardId,
        queryEmbedding,
        searchLimit,
      );
      const redisSearchTime = Date.now() - redisStartTime;

      if (cached && cached.length > 0) {
        this.metricsService.recordCacheHit(redisSearchTime);
        this.logger.log(
          `✅ Redis cache HIT: ${cached.length} results (${redisSearchTime}ms)`,
        );
        return cached;
      }

      this.metricsService.recordCacheMiss();
      this.logger.warn(`⚠️  Redis cache MISS - falling back to PGVector`);

      // 🔍 Fallback to PGVector (SLOW PATH)
      const pgStartTime = Date.now();
      const pgResults = await this.searchService.searchPGVector(
        wardId,
        queryEmbedding,
        searchLimit,
      );
      const pgSearchTime = Date.now() - pgStartTime;
      this.metricsService.recordPgvectorSearch(pgSearchTime);

      return pgResults;
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get recent conversation context
   */
  async getRecentContext(
    wardId: string,
    limit: number = 10,
  ): Promise<ContextResult[]> {
    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    return this.cacheService.getRecentContext(wardId, limit);
  }

  /**
   * Generate personalized greeting
   */
  async generatePersonalizedGreeting(
    wardId: string,
    callDirection: 'inbound' | 'outbound' = 'inbound',
  ): Promise<string> {
    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    if (!this.greetingGenerator) {
      throw new Error('Greeting generator not initialized');
    }

    return this.greetingGenerator.generatePersonalizedGreeting(
      wardId,
      callDirection,
    );
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return this.metricsService.getMetrics();
  }

  /**
   * Reset performance metrics
   */
  resetPerformanceMetrics(): void {
    this.metricsService.reset();
  }

  // ========== Private Helper Methods ==========

  /**
   * Chunk conversation into smaller pieces
   */
  private chunkConversation(
    transcripts: TranscriptLine[],
  ): Array<{ text: string; transcripts: TranscriptLine[] }> {
    const chunks: Array<{ text: string; transcripts: TranscriptLine[] }> = [];
    let currentChunk: TranscriptLine[] = [];
    let currentLength = 0;
    const buildLineText = (t: TranscriptLine) => `[${t.speaker}]: ${t.text}`;

    for (const transcript of transcripts) {
      const lineText = buildLineText(transcript);
      const lineLength = lineText.length;

      if (
        currentLength + lineLength > this.CHUNK_SIZE &&
        currentChunk.length > 0
      ) {
        chunks.push({
          text: currentChunk.map(buildLineText).join('\n'),
          transcripts: currentChunk,
        });

        if (this.CHUNK_OVERLAP > 0) {
          let overlapLength = 0;
          let overlapStart = currentChunk.length;
          while (overlapStart > 0 && overlapLength < this.CHUNK_OVERLAP) {
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

    if (currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.map(buildLineText).join('\n'),
        transcripts: currentChunk,
      });
    }

    return chunks;
  }

  /**
   * Index a single chunk
   */
  private async indexChunk(
    wardId: string,
    callId: string,
    chunkText: string,
    transcripts: any[],
    extraMetadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      // Get call start time and convert to KST
      const callStartUtc = transcripts[0]?.timestamp
        ? new Date(transcripts[0].timestamp)
        : new Date();
      const callStartKst = toKST(callStartUtc);
      const datePrefix = `[날짜: ${formatKST(callStartKst)}]`;

      // Add date prefix to chunk text
      const chunkTextWithDate = `${datePrefix} ${chunkText}`;

      // Generate embedding
      const embedding =
        await this.embeddingService.generateEmbedding(chunkTextWithDate);

      // Extract metadata
      const metadata = {
        speakers: [...new Set(transcripts.map(t => t.speaker))],
        timestamp: transcripts[0]?.timestamp,
        callDate: callStartKst.toISOString(),
        callStartAt: callStartKst.toISOString(),
        chunkLength: chunkText.length,
        ...extraMetadata,
      };

      const embeddingStr = JSON.stringify(embedding);
      const metadataStr = JSON.stringify(metadata);

      // Store in PGVector
      await this.prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO conversation_vectors (ward_id, call_id, chunk_text, embedding, metadata)
          VALUES (
            ${wardId}::uuid,
            ${callId}::uuid,
            ${chunkTextWithDate},
            ${embeddingStr}::vector,
            ${metadataStr}::jsonb
          )
        `,
      );

      this.logger.debug(`Indexed chunk: ${chunkText.substring(0, 50)}...`);
    } catch (error) {
      this.logger.error(`Failed to index chunk: ${error.message}`, error.stack);
      throw error;
    }
  }
}
