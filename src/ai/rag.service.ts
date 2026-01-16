import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { GreetingGenerator } from './rag.greeting';

// RAG 서브 서비스들
import { RagConfig } from './rag/rag.config';
import { RagProcessor } from './rag/rag.processor';
import { RagRepository } from './rag/rag.repository';
import { RagEmbeddingService } from './rag/rag.embedding.service';
import { RagSearchService } from './rag/rag.search.service';
import { RagCacheService } from './rag/rag.cache.service';
import { RagMetricsService } from './rag/rag.metrics.service';
import { isValidEmbedding } from './rag/rag.utils';

// Types
import {
  TranscriptLine,
  SearchResult,
  ContextResult,
  PerformanceMetrics,
} from './rag/rag.types';

/**
 * RAG Service - Main Orchestrator
 *
 * 역할: 전체 RAG 흐름을 조율하는 오케스트레이터
 *
 * 위임:
 * - RagConfig: 환경 변수 검증 및 설정 관리
 * - RagProcessor: 요약 생성 + 청킹 + 임베딩 로직
 * - RagRepository: DB CRUD (Parent-Child 트랜잭션)
 * - RagEmbeddingService: Bedrock Titan 임베딩 생성
 * - RagSearchService: 하이브리드 검색 (Vector + FTS + RRF)
 * - RagCacheService: Redis 캐시 관리
 * - RagMetricsService: 성능 메트릭 추적
 *
 * Architecture (v2 - Dense Summary + Contextual Header):
 * - Parent: LLM이 생성한 고밀도 상세 요약본 저장
 * - Child: 문맥 헤더([날짜|주제|키워드])가 포함된 청크 + 임베딩 저장
 * - 검색 시 헤더 덕분에 유사도가 대폭 상승 (0.5~0.7 수준)
 *
 * Fallback 전략:
 * - LLM 요약 실패 시 → v1 Raw 방식으로 자동 전환
 * - 임베딩 전체 실패 시 → v1 Raw 방식으로 자동 전환
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private greetingGenerator: GreetingGenerator | null = null;

  constructor(
    private readonly config: RagConfig,
    private readonly processor: RagProcessor,
    private readonly repository: RagRepository,
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
        bedrockClient: () => this.embeddingService.getBedrockClient(),
        redisClient: () => this.cacheService.getRedisClient(),
        getRecentContext: (wardId: string, limit?: number) =>
          this.getRecentContext(wardId, limit),
        getGreetingCacheKey: (wardId: string) =>
          this.cacheService.getGreetingCacheKey(wardId),
      },
      {
        llmModel: this.config.llmModel,
        maxContextChars: this.config.maxContextChars,
        maxGreetingTokens: this.config.maxGreetingTokens,
        redisGreetingTTL: this.config.redisGreetingTtl,
      },
    );

    this.logger.log(
      `RAG Service initialized (orchestrator mode, dense_summary=${this.config.useDenseSummary})`,
    );
  }

  // ==========================================================================
  // 인덱싱 API
  // ==========================================================================

  /**
   * 대화 인덱싱 (메인 엔트리 포인트)
   *
   * v2 모드 (기본):
   * 1. LLM으로 고밀도 요약 + 문맥 헤더 청크 생성
   * 2. 각 청크 임베딩 후 DB 저장
   *
   * v1 모드 (Fallback):
   * - LLM 실패 시 자동 전환
   * - 원본 텍스트 기반 청킹 + 임베딩
   *
   * @param callId 통화 ID
   * @param wardId 어르신 ID
   * @param transcripts 원본 스크립트 배열
   */
  async indexConversation(
    callId: string,
    wardId: string,
    transcripts: TranscriptLine[],
  ): Promise<void> {
    // 입력 검증
    if (!callId || !wardId) {
      throw new BadRequestException('callId and wardId are required');
    }

    if (!transcripts || transcripts.length === 0) {
      this.logger.warn(
        `Empty transcripts for call=${callId}, ward=${wardId}. Skipping indexing.`,
      );
      return;
    }

    try {
      this.logger.log(
        `Indexing conversation: callId=${callId}, wardId=${wardId}, lines=${transcripts.length}`,
      );

      // 통화 날짜 정보 추출
      const { callStartKst, callDateStr } =
        this.processor.extractCallDateInfo(transcripts);

      if (this.config.useDenseSummary) {
        // v2: Dense Summary 모드
        await this.indexWithDenseSummary(
          callId,
          wardId,
          transcripts,
          callDateStr,
          callStartKst,
        );
      } else {
        // v1: Raw 모드
        await this.indexWithRawTranscripts(callId, wardId, transcripts);
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to index conversation: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * v2: Dense Summary 기반 인덱싱
   *
   * Fallback 전략:
   * - LLM 요약 실패 → v1 Raw 모드로 전환
   * - 임베딩 전체 실패 → v1 Raw 모드로 전환
   */
  private async indexWithDenseSummary(
    callId: string,
    wardId: string,
    transcripts: TranscriptLine[],
    callDate: string,
    callStartKst: Date,
  ): Promise<void> {
    this.logger.log(`Starting dense summary indexing for call=${callId}`);

    try {
      // Step 1-2: 요약 + 청크 생성 + 임베딩 (Single LLM Call)
      const summaryResult = await this.processor.processWithDenseSummary(
        transcripts,
        callDate,
      );

      this.logger.log(
        `✅ Dense summary generated: ${summaryResult.metadata.chunkCount} chunks`,
      );

      // Step 3: DB 저장 (트랜잭션)
      const embeddedChunkBatches =
        this.processor.embedContextualChunksInBatches(summaryResult.chunks);
      const parentId = await this.repository.saveWithDenseSummary(
        wardId,
        callId,
        summaryResult,
        embeddedChunkBatches,
        callStartKst,
        transcripts,
      );

      this.logger.log(
        `✅ Dense Summary indexing complete: call=${callId}, parentId=${parentId}, ${summaryResult.metadata.chunkCount} chunks`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Dense summary failed: ${error.message}. Falling back to raw indexing.`,
      );
      // Fallback: 원본 기반 인덱싱
      await this.indexWithRawTranscripts(callId, wardId, transcripts);
    }
  }

  /**
   * v1: Raw 텍스트 기반 인덱싱 (Fallback)
   */
  private async indexWithRawTranscripts(
    callId: string,
    wardId: string,
    transcripts: TranscriptLine[],
  ): Promise<void> {
    this.logger.log(`Using raw transcript indexing for call=${callId}`);

    // Step 1: 대화를 Parent 청크로 분할
    const parentChunks =
      await this.processor.processWithRawTranscripts(transcripts);

    this.logger.log(
      `Created ${parentChunks.length} parent chunks for indexing`,
    );

    // Step 2: 각 Parent 청크 처리 (순차 처리)
    let successCount = 0;
    let failureCount = 0;

    for (const parentChunk of parentChunks) {
      try {
        const { parentTextWithDate, embeddedChildren, metadata } =
          await this.processor.processParentChunk(parentChunk, wardId, callId);

        if (embeddedChildren.length === 0) {
          throw new Error('No children generated for parent chunk');
        }

        await this.repository.saveWithRawChunks(
          wardId,
          callId,
          parentTextWithDate,
          embeddedChildren,
          metadata,
        );
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Parent chunk failed: ${message}`);
      }
    }

    if (failureCount > 0) {
      this.logger.warn(
        `⚠️ Indexed ${successCount}/${parentChunks.length} parent chunks for call=${callId}. ${failureCount} failed.`,
      );

      if (successCount === 0) {
        throw new Error(
          `Failed to index conversation ${callId}: all parent chunks failed`,
        );
      }
    } else {
      this.logger.log(
        `✅ Indexed ${parentChunks.length} parent chunks for call=${callId}`,
      );
    }
  }

  // ==========================================================================
  // 검색 API
  // ==========================================================================

  /**
   * 유사 대화 검색
   *
   * Hybrid 검색:
   * 1. Redis 캐시 확인 (Fast Path)
   * 2. Hybrid Search (Slow Path - Fallback)
   *    - Vector Search (pgvector)
   *    - Full-Text Search (PostgreSQL FTS)
   *    - RRF (Reciprocal Rank Fusion)
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
      const searchLimit = limit || this.config.searchLimit;
      this.logger.log(
        `RAG search: ward=${wardId.substring(0, 8)}..., query="${query.substring(0, 30)}...", limit=${searchLimit}`,
      );

      // Query 임베딩 생성
      let queryEmbedding: number[] = [];
      try {
        const embeddingStartTime = Date.now();
        queryEmbedding = await this.embeddingService.generateEmbedding(query);
        const embeddingTime = Date.now() - embeddingStartTime;
        this.debug(`Embedding generated in ${embeddingTime}ms`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `⚠️ Embedding generation failed, falling back to FTS-only search: ${message}`,
        );
      }

      const hasValidEmbedding = isValidEmbedding(queryEmbedding);

      // 🚀 Redis 캐시 검색 (Fast Path)
      if (hasValidEmbedding) {
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
      } else {
        this.logger.warn(
          '⚠️ Invalid embedding detected - skipping Redis cache search',
        );
      }

      // Cache miss or skip
      this.metricsService.recordCacheMiss();
      this.logger.warn(
        hasValidEmbedding
          ? '⚠️ Redis cache MISS - falling back to Hybrid Search'
          : '⚠️ Redis cache skipped - proceeding to Hybrid Search (invalid embedding)',
      );

      // 🔍 PGVector 검색 (Slow Path)
      // 하이브리드 검색: Vector + FTS + RRF
      const pgStartTime = Date.now();
      const pgResults = await this.searchService.searchPGVector(
        wardId,
        queryEmbedding,
        searchLimit,
        query, // FTS를 위한 쿼리 전달
      );
      const pgSearchTime = Date.now() - pgStartTime;
      this.metricsService.recordPgvectorSearch(pgSearchTime);

      this.logger.log(
        `✅ Hybrid search: ${pgResults.length} results (${pgSearchTime}ms)`,
      );

      return pgResults;
    } catch (error) {
      this.logger.error(`❌ RAG search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ==========================================================================
  // 컨텍스트 API
  // ==========================================================================

  /**
   * 최근 대화 문맥 조회
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
   * 주간 컨텍스트 Redis에 프리로드
   */
  async preloadWeeklyContext(wardId: string): Promise<void> {
    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    return this.cacheService.preloadWeeklyContext(wardId);
  }

  // ==========================================================================
  // 인사말 API
  // ==========================================================================

  /**
   * 맞춤형 인사말 생성
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
   * 표준 인사말 캐싱 (Fallback용)
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
      const greeting =
        this.greetingGenerator.getStandardGreeting(callDirection);
      const greetingKey = this.cacheService.getGreetingCacheKey(wardId);

      await redisClient.setEx(
        greetingKey,
        this.config.redisGreetingTtl,
        greeting,
      );
      await redisClient.publish(`greeting:ward:${wardId}`, greeting);

      this.logger.log(`Fallback greeting cached/published for ward=${wardId}`);
    } catch (error) {
      this.logger.warn(`Failed to cache fallback greeting: ${error.message}`);
    }
  }

  // ==========================================================================
  // 메트릭 API
  // ==========================================================================

  /**
   * 성능 메트릭 조회
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return this.metricsService.getMetrics();
  }

  /**
   * 성능 메트릭 초기화
   */
  resetPerformanceMetrics(): void {
    this.metricsService.reset();
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private debug(message: string): void {
    if (this.config.debugLogs) {
      this.logger.debug(message);
    }
  }
}
