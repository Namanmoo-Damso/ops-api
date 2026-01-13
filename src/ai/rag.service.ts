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
import {
  toKST,
  formatKST,
  splitIntoChildChunks,
  ChildChunk,
} from './rag/rag.utils';
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
  // Parent-Child configuration
  private readonly CHILD_CHUNK_SIZE = parseInt(
    process.env.RAG_CHILD_CHUNK_SIZE || '200',
    10,
  );
  private readonly CHILD_CHUNK_OVERLAP = parseInt(
    process.env.RAG_CHILD_CHUNK_OVERLAP || '50',
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
    this.greetingGenerator = new GreetingGenerator(
      {
        logger: this.logger,
        // Use lazy getter to avoid module initialization order issues
        bedrockClient: () => this.embeddingService.getBedrockClient(),
        redisClient: () => this.cacheService.getRedisClient(),
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
   * Index conversation from a call using Parent-Child structure
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
        `Indexing conversation (Parent-Child): callId=${callId}, wardId=${wardId}, transcripts=${transcripts.length}`,
      );

      // Step 1: Chunk the conversation into parent chunks
      const parentChunks = this.chunkConversation(transcripts);
      this.logger.log(
        `Created ${parentChunks.length} parent chunks for indexing`,
      );

      // Step 2: Index each parent and its children
      const indexPromises = parentChunks.map(parentChunk =>
        this.indexParentWithChildren(
          wardId,
          callId,
          parentChunk.text,
          parentChunk.transcripts,
        ),
      );

      const results = await Promise.allSettled(indexPromises);
      const failures = results
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.status === 'rejected');
      const successCount = results.length - failures.length;

      if (failures.length > 0) {
        this.logger.warn(
          `⚠️ Indexed ${successCount}/${parentChunks.length} parent chunks for call: ${callId}. ${failures.length} failed.`,
        );

        for (const failure of failures) {
          const reason = (failure.result as PromiseRejectedResult).reason;
          const message =
            reason instanceof Error ? reason.message : String(reason);
          const stack = reason instanceof Error ? reason.stack : undefined;
          this.logger.error(
            `Parent chunk ${failure.index + 1}/${parentChunks.length} failed to index: ${message}`,
            stack,
          );
        }

        if (successCount === 0) {
          throw new Error(
            `Failed to index conversation ${callId}: all parent chunks failed`,
          );
        }
      } else {
        this.logger.log(
          `✅ Indexed ${parentChunks.length} parent chunks with children for call: ${callId}`,
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
      this.logger.log(
        `🔍 RAG search started: ward=${wardId.substring(0, 8)}..., query="${query.substring(0, 30)}...", limit=${searchLimit}`,
      );

      // Generate query embedding
      this.logger.debug(`📝 Generating embedding for query: "${query}"`);
      const embeddingStartTime = Date.now();
      const queryEmbedding =
        await this.embeddingService.generateEmbedding(query);
      const embeddingTime = Date.now() - embeddingStartTime;
      this.logger.debug(
        `✅ Embedding generated in ${embeddingTime}ms (${queryEmbedding.length} dimensions)`,
      );

      // 🚀 Try Redis cache first (FAST PATH)
      this.logger.debug(`🔄 Checking Redis cache...`);
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
          `✅ Redis cache HIT: ${cached.length} results (${redisSearchTime}ms) - returning cached results`,
        );
        return cached;
      }

      // Cache miss - log reason
      if (cached === null) {
        this.logger.warn(
          `⚠️  Redis cache MISS: No cache data found for ward=${wardId.substring(0, 8)}...`,
        );
      } else {
        this.logger.warn(
          `⚠️  Redis cache MISS: Cache empty (0 results) - falling back to PGVector`,
        );
      }

      this.metricsService.recordCacheMiss();

      // 🔍 Fallback to PGVector (SLOW PATH)
      this.logger.log(`🔍 Searching PGVector database...`);
      const pgStartTime = Date.now();
      const pgResults = await this.searchService.searchPGVector(
        wardId,
        queryEmbedding,
        searchLimit,
      );
      const pgSearchTime = Date.now() - pgStartTime;
      this.metricsService.recordPgvectorSearch(pgSearchTime);

      this.logger.log(
        `✅ PGVector search completed: ${pgResults.length} results (${pgSearchTime}ms)`,
      );

      return pgResults;
    } catch (error) {
      this.logger.error(
        `❌ RAG search failed for ward=${wardId.substring(0, 8)}..., query="${query}": ${error.message}`,
        error.stack,
      );
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
   * Cache and publish a standard greeting (fallback for pre-warm failures)
   */
  async cacheStandardGreeting(
    wardId: string,
    callDirection: 'inbound' | 'outbound' = 'inbound',
  ): Promise<void> {
    if (!wardId) {
      this.logger.warn('cacheStandardGreeting called without wardId');
      return;
    }

    if (!this.greetingGenerator) {
      this.logger.warn('Greeting generator not initialized for fallback');
      return;
    }

    const redisClient = this.cacheService.getRedisClient();
    if (!redisClient) {
      this.logger.warn('Redis client not available for greeting fallback');
      return;
    }

    try {
      const greeting = this.greetingGenerator.getStandardGreeting(callDirection);
      const greetingKey = this.cacheService.getGreetingCacheKey(wardId);

      await redisClient.setEx(
        greetingKey,
        this.REDIS_GREETING_TTL,
        greeting,
      );
      await redisClient.publish(`greeting:ward:${wardId}`, greeting);

      this.logger.log(
        `Fallback greeting cached/published for ward=${wardId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to cache fallback greeting for ward=${wardId}: ${error.message}`,
      );
    }
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
   * Index a parent chunk with its children (Parent-Child structure)
   */
  private async indexParentWithChildren(
    wardId: string,
    callId: string,
    parentText: string,
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

      // Add date prefix to parent text
      const parentTextWithDate = `${datePrefix} ${parentText}`;

      // Extract metadata
      const metadata = {
        speakers: [...new Set(transcripts.map(t => t.speaker))],
        timestamp: transcripts[0]?.timestamp,
        callDate: callStartKst.toISOString(),
        callStartAt: callStartKst.toISOString(),
        parentLength: parentText.length,
        ...extraMetadata,
      };

      // Step 1: Split parent into child chunks
      const childChunks = splitIntoChildChunks(
        parentTextWithDate,
        this.CHILD_CHUNK_SIZE,
        this.CHILD_CHUNK_OVERLAP,
      );

      if (childChunks.length === 0) {
        this.logger.warn(
          `No child chunks generated for call=${callId} ward=${wardId}`,
        );
        return;
      }

      // Step 2: Precompute child embeddings before DB transaction
      const BATCH_SIZE = 50;
      const childRows: Array<{
        chunk: ChildChunk;
        embeddingStr: string;
        metadataStr: string;
      }> = [];

      for (
        let batchStart = 0;
        batchStart < childChunks.length;
        batchStart += BATCH_SIZE
      ) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, childChunks.length);
        const batch = childChunks.slice(batchStart, batchEnd);

        for (const childChunk of batch) {
          const embedding = await this.embeddingService.generateEmbedding(
            childChunk.text,
          );
          const embeddingStr = JSON.stringify(embedding);
          const childMetadata = {
            ...metadata,
            childLength: childChunk.text.length,
          };
          const metadataStr = JSON.stringify(childMetadata);

          childRows.push({
            chunk: childChunk,
            embeddingStr,
            metadataStr,
          });
        }
      }

      // Step 3: Insert parent + children atomically
      let parentId: string | null = null;
      await this.prisma.$transaction(async tx => {
        const metadataStr = JSON.stringify(metadata);
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

        for (
          let batchStart = 0;
          batchStart < childRows.length;
          batchStart += BATCH_SIZE
        ) {
          const batchEnd = Math.min(
            batchStart + BATCH_SIZE,
            childRows.length,
          );
          const batch = childRows.slice(batchStart, batchEnd);

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
        `✅ Indexed ${childRows.length} children for parent ${parentId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to index parent with children: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
