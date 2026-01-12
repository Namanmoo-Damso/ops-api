import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createClient, type RedisClientType } from 'redis';
import {
  buildContextualChunks,
  type TranscriptLine,
} from './rag.chunks';
import { GreetingGenerator } from './rag.greeting';

/**
 * RAG Service - Vector Search with PGVector
 *
 * Architecture:
 * - Storage: PGVector (permanent storage for all conversation vectors)
 * - Embeddings: AWS Bedrock Titan Embeddings V2 (1024 dimensions)
 * - Search: Cosine similarity using pgvector extension
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private bedrockClient: BedrockRuntimeClient;
  private redisClient: RedisClientType | null = null;
  private greetingGenerator: GreetingGenerator | null = null;

  // Configuration from environment variables
  private readonly VECTOR_DIMENSIONS = parseInt(
    process.env.VECTOR_DIMENSIONS || '1024',
    10,
  );
  private readonly EMBEDDING_MODEL =
    process.env.EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
  private readonly LLM_MODEL =

    process.env.BEDROCK_MODEL ||
    'anthropic.claude-3-5-sonnet-20241022-v2:0';
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

  // Retry configuration for AWS Bedrock
  private readonly BEDROCK_MAX_RETRIES = 3;
  private readonly BEDROCK_RETRY_DELAY = 1000; // ms
  private readonly BEDROCK_RETRY_BACKOFF = 2; // exponential backoff multiplier

  // Redis cache configuration
  private readonly REDIS_CACHE_TTL = 3600; // 1 hour
  private readonly REDIS_GREETING_TTL = 600; // 1 hour for greeting cache
  private readonly WEEKLY_CONTEXT_DAYS = 7;

  // LLM input limits for greeting generation
  private readonly MAX_CONTEXT_CHARS = 3000; // Max characters for context (≈750 tokens)
  private readonly MAX_GREETING_TOKENS = 200; // Max tokens for greeting output

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Initialize AWS Bedrock client
    const awsRegion = process.env.AWS_REGION || 'ap-northeast-2';
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      throw new Error('AWS credentials are required for RAG service');
    }

    this.bedrockClient = new BedrockRuntimeClient({
      region: awsRegion,
      credentials: {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
    });

    // Initialize Redis client for vector cache
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redisClient = createClient({ url: redisUrl });
        await this.redisClient.connect();
        this.logger.log('Redis connected for RAG vector cache');
      } catch (error) {
        this.logger.warn(
          `Redis connection failed: ${error.message}. Vector cache disabled.`,
        );
        this.redisClient = null;
      }
    } else {
      this.logger.warn('REDIS_URL not set - vector cache disabled');
    }

    this.logger.log(
      'RAG Service initialized (Bedrock Titan Embeddings V2 + PGVector)',
    );
    this.logger.log(
      `Config: Model=${this.EMBEDDING_MODEL}, Dimensions=${this.VECTOR_DIMENSIONS}`,
    );

    this.greetingGenerator = new GreetingGenerator(
      {
        logger: this.logger,
        bedrockClient: this.bedrockClient,
        redisClient: this.redisClient,
        getRecentContext: (wardId: string, limit?: number) =>
          this.getRecentContext(wardId, limit),
      },
      {
        llmModel: this.LLM_MODEL,
        maxContextChars: this.MAX_CONTEXT_CHARS,
        maxGreetingTokens: this.MAX_GREETING_TOKENS,
        redisGreetingTTL: this.REDIS_GREETING_TTL,
      },
    );
  }

  /**
   * Index conversation from a call
   * - Accepts transcript data directly (same data used for AI analysis)
   * - Chunks text into smaller pieces
   * - Generates embeddings
   * - Stores in PGVector
   * - Supports partial failure (continues even if some chunks fail)
   */
  async indexConversation(
    callId: string,
    wardId: string,
    transcripts: TranscriptLine[],
  ): Promise<void> {
    try {
      this.logger.log(
        `Indexing conversation: callId=${callId}, wardId=${wardId}`,
      );

      if (!transcripts || transcripts.length === 0) {
        this.logger.warn(`No transcripts provided for call: ${callId}`);
        return;
      }

      // 최근 7일 맥락을 참고하여 청크 구성
      const pastContext = await this.getRecentContext(wardId, 20);
      const pastContextText = pastContext
        .map(c => c.text)
        .filter(Boolean)
        .join('\n');

      const enrichedChunks = buildContextualChunks(transcripts, pastContextText, {
        chunkSize: this.CHUNK_SIZE,
      });
      this.logger.log(
        `Created ${enrichedChunks.length} contextual chunk(s) for call: ${callId}`,
      );

      // Generate embeddings and store with partial failure support
      let successCount = 0;
      let failureCount = 0;

      for (const chunk of enrichedChunks) {
        try {
          await this.indexChunk(
            wardId,
            callId,
            chunk.content,
            transcripts,
            chunk.metadata,
          );
          successCount++;
        } catch (error) {
          failureCount++;
          this.logger.error(
            `Failed to index chunk ${successCount + failureCount}/${enrichedChunks.length}: ${error.message}`,
          );
          // Continue processing remaining chunks instead of failing entirely
        }
      }

      if (failureCount > 0) {
        this.logger.warn(
          `Partial indexing for call ${callId}: ${successCount} succeeded, ${failureCount} failed`,
        );
      } else {
        this.logger.log(
          `Successfully indexed ${successCount} chunk(s) for call: ${callId}`,
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
   * Preload weekly context into Redis when call starts
   * - Fetches 7 days of conversation vectors from PGVector
   * - Caches in Redis for fast access during call
   * - Automatically expires after 1 hour
   */
  async preloadWeeklyContext(wardId: string): Promise<void> {
    if (!this.redisClient) {
      this.logger.warn('Redis not available - skipping context preload');
      return;
    }

    try {
      this.logger.log(`Preloading weekly context for ward: ${wardId}`);

      // Fetch last 7 days of vectors from PGVector
      const weekAgo = new Date();
      // Include the full 7 calendar days (00:00 UTC of 7 days ago)
      weekAgo.setUTCDate(weekAgo.getUTCDate() - this.WEEKLY_CONTEXT_DAYS);
      weekAgo.setUTCHours(0, 0, 0, 0);

      const vectors = await this.prisma.$queryRaw<
        Array<{
          id: string;
          chunk_text: string;
          embedding: string;
          metadata: any;
          created_at: Date;
        }>
      >(
        Prisma.sql`
          SELECT id, chunk_text, embedding::text, metadata, created_at
          FROM conversation_vectors
          WHERE ward_id = ${wardId}::uuid
            AND created_at >= ${weekAgo}
          ORDER BY created_at DESC
        `,
      );

      if (vectors.length === 0) {
        this.logger.log(`No weekly context found for ward: ${wardId}`);
        return;
      }

      // Store in Redis with structure: rag:ward:{wardId}:vectors
      const cacheKey = `rag:ward:${wardId}:vectors`;
      const cacheData = JSON.stringify(vectors);

      await this.redisClient.setEx(cacheKey, this.REDIS_CACHE_TTL, cacheData);

      this.logger.log(
        `✅ Preloaded ${vectors.length} vectors for ward ${wardId} (expires in ${this.REDIS_CACHE_TTL}s)`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to preload weekly context: ${error.message}`,
        error.stack,
      );
      // Don't throw - allow call to continue without cache
    }
  }

  /**
   * Search for relevant conversation context
   * - First checks Redis cache (fast)
   * - Falls back to PGVector if cache miss
   * - Returns most relevant chunks
   */
  async searchSimilar(
    wardId: string,
    query: string,
    limit?: number,
  ): Promise<Array<{ text: string; metadata: any; similarity: number }>> {
    try {
      const searchLimit = limit || this.SEARCH_LIMIT;
      this.logger.log(
        `Searching for: "${query}" (ward=${wardId}, limit=${searchLimit})`,
      );

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Try Redis cache first (fast path)
      if (this.redisClient) {
        try {
          const cached = await this.searchRedisCache(
            wardId,
            queryEmbedding,
            searchLimit,
          );
          if (cached && cached.length > 0) {
            this.logger.log(`✅ Redis cache HIT: ${cached.length} results`);
            return cached;
          }
          this.logger.log(`⚠️  Redis cache MISS - falling back to PGVector`);
        } catch (error) {
          this.logger.warn(
            `Redis search failed: ${error.message} - falling back to PGVector`,
          );
        }
      }

      // Fallback to PGVector (slower but always works)
      this.logger.log(`Searching PGVector for similar contexts...`);
      const pgResults = await this.searchPGVector(
        wardId,
        queryEmbedding,
        searchLimit,
      );

      return pgResults;
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Search Redis cache for similar vectors
   * - Uses cached weekly context
   * - Calculates cosine similarity in-memory
   */
  private async searchRedisCache(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<Array<{
    text: string;
    metadata: any;
    similarity: number;
  }> | null> {
    if (!this.redisClient) return null;

    const cacheKey = `rag:ward:${wardId}:vectors`;
    const cached = await this.redisClient.get(cacheKey);

    if (!cached) return null;

    const vectors: Array<{
      id: string;
      chunk_text: string;
      embedding: string;
      metadata: any;
      created_at: Date;
    }> = JSON.parse(cached);

    // Calculate cosine similarity for each vector
    const results: Array<{ text: string; metadata: any; similarity: number }> =
      [];

    for (const vec of vectors) {
      try {
        // Parse embedding from PostgreSQL vector format: "[1,2,3,...]"
        const embedding: number[] = JSON.parse(vec.embedding);
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        results.push({
          text: vec.chunk_text,
          metadata: vec.metadata,
          similarity,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to parse embedding for vector ${vec.id}: ${error.message}`,
        );
      }
    }

    // Sort by similarity (highest first) and return top N
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  /**
   * Get conversation history for a ward (useful for context building)
   *
   * Strategy:
   * 1. Try Redis cache first (fast) - populated by preloadWeeklyContext()
   * 2. Fallback to PGVector if cache miss
   *
   * Uses Prisma.sql for type-safe, SQL injection-proof queries
   */
  async getRecentContext(
    wardId: string,
    limit: number = 10,
  ): Promise<Array<{ text: string; createdAt: Date }>> {
    try {
      // 🚀 Try Redis cache first (FAST PATH)
      if (this.redisClient) {
        const cacheKey = `rag:ward:${wardId}:vectors`;
        const cached = await this.redisClient.get(cacheKey);

        if (cached) {
          this.logger.log(
            `✅ Redis cache HIT for recent context: ward=${wardId}`,
          );

          // Parse cached vectors and return most recent ones
          const vectors = JSON.parse(cached) as Array<{
            chunk_text: string;
            created_at: string;
          }>;

          // Already sorted by created_at DESC from preload
          return vectors.slice(0, limit).map(v => ({
            text: v.chunk_text,
            createdAt: new Date(v.created_at),
          }));
        }

        this.logger.log(
          `⚠️  Redis cache MISS for recent context: ward=${wardId}`,
        );
      }

      // 🐢 Fallback to PGVector (SLOW PATH)
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
      this.logger.error(`Failed to get recent context: ${error.message}`);
      throw error;
    }
  }

  // ========================================================================
  // Private helper methods
  // ========================================================================

  /**
   * Generate embedding with exponential backoff retry logic
   * Handles transient network errors and rate limiting
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.BEDROCK_MAX_RETRIES; attempt++) {
      try {
        // Prepare Bedrock Titan Embeddings V2 request
        const requestBody = {
          inputText: text,
          dimensions: this.VECTOR_DIMENSIONS,
          normalize: true, // Normalize vectors for cosine similarity
        };

        const command = new InvokeModelCommand({
          modelId: this.EMBEDDING_MODEL,
          body: JSON.stringify(requestBody),
          contentType: 'application/json',
          accept: 'application/json',
        });

        const response = await this.bedrockClient.send(command);
        const responseBody = JSON.parse(
          new TextDecoder().decode(response.body),
        );

        // Titan V2 returns: { embedding: number[], inputTextTokenCount: number }
        return responseBody.embedding;
      } catch (error) {
        lastError = error;
        const isRetryableError = this.isRetryableError(error);

        if (attempt < this.BEDROCK_MAX_RETRIES - 1 && isRetryableError) {
          const delayMs =
            this.BEDROCK_RETRY_DELAY *
            Math.pow(this.BEDROCK_RETRY_BACKOFF, attempt);
          this.logger.warn(
            `Bedrock embedding failed (attempt ${attempt + 1}/${this.BEDROCK_MAX_RETRIES}): ${error.message}. Retrying in ${delayMs}ms...`,
          );
          await this.sleep(delayMs);
        } else {
          // Non-retryable error or final attempt
          this.logger.error(
            `Failed to generate embedding after ${attempt + 1} attempt(s): ${error.message}`,
          );
          break;
        }
      }
    }

    throw lastError || new Error('Failed to generate embedding');
  }

  /**
   * Check if error is retryable (network issues, throttling, etc.)
   */
  private isRetryableError(error: any): boolean {
    // Retry on network errors
    if (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    ) {
      return true;
    }

    // Retry on AWS throttling errors
    if (
      error.name === 'ThrottlingException' ||
      error.name === 'TooManyRequestsException'
    ) {
      return true;
    }

    // Retry on service unavailable
    if (
      error.name === 'ServiceUnavailableException' ||
      error.$metadata?.httpStatusCode === 503
    ) {
      return true;
    }

    // Don't retry on validation errors or auth errors
    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Index a single chunk with safe parameterized queries
   * Prevents SQL injection through Prisma's tagged templates
   */
  private async indexChunk(
    wardId: string,
    callId: string,
    chunkText: string,
    transcripts: any[],
    extraMetadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      // Generate embedding with retry logic
      const embedding = await this.generateEmbedding(chunkText);

      // Extract metadata
      const metadata = {
        speakers: [...new Set(transcripts.map(t => t.speaker))],
        timestamp: transcripts[0]?.timestamp,
        chunkLength: chunkText.length,
        ...extraMetadata,
      };

      // Safely convert to PostgreSQL types
      const embeddingStr = JSON.stringify(embedding);
      const metadataStr = JSON.stringify(metadata);

      // Store in PGVector only (permanent storage)
      // Use Prisma.sql for type-safe, SQL injection-proof queries
      await this.prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO conversation_vectors (ward_id, call_id, chunk_text, embedding, metadata)
          VALUES (
            ${wardId}::uuid,
            ${callId}::uuid,
            ${chunkText},
            ${embeddingStr}::vector,
            ${metadataStr}::jsonb
          )
        `,
      );

      this.logger.debug(`Indexed chunk: ${chunkText.substring(0, 50)}...`);
    } catch (error) {
      this.logger.error(`Failed to index chunk: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search PGVector for similar conversations
   * Uses Prisma.sql for type-safe, SQL injection-proof queries
   */
  private async searchPGVector(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<Array<{ text: string; metadata: any; similarity: number }>> {
    try {
      // Safely convert embedding array to PostgreSQL vector format
      // Use Prisma.sql for parameterized queries
      const embeddingStr = JSON.stringify(queryEmbedding);

      const results = await this.prisma.$queryRaw<
        Array<{
          chunk_text: string;
          metadata: any;
          similarity: number;
        }>
      >(
        Prisma.sql`
          SELECT
            chunk_text,
            metadata,
            1 - (embedding <=> ${embeddingStr}::vector) AS similarity
          FROM conversation_vectors
          WHERE ward_id = ${wardId}::uuid
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT ${limit}
        `,
      );

      return results.map(r => ({
        text: r.chunk_text,
        metadata: r.metadata,
        similarity: r.similarity,
      }));
    } catch (error) {
      this.logger.error(`PGVector search failed: ${error.message}`);
      throw error;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Generate personalized greeting for elderly ward
   *
   * Analyzes last 7 days of conversation context to create a warm, contextual greeting
   * that references recent topics (health, family, emotional state).
   *
   * @param wardId Ward UUID
   * @param callDirection "inbound" or "outbound"
   * @returns Personalized greeting string in Korean
   */
  async generatePersonalizedGreeting(
    wardId: string,
    callDirection: 'inbound' | 'outbound' = 'inbound',
  ): Promise<string> {
    return this.getGreetingGenerator().generatePersonalizedGreeting(
      wardId,
      callDirection,
    );
  }

  private getGreetingGenerator(): GreetingGenerator {
    if (!this.greetingGenerator) {
      throw new Error('Greeting generator not initialized');
    }
    return this.greetingGenerator;
  }
}
