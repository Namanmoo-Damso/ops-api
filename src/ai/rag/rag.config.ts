import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * RAG Configuration Service
 *
 * 환경 변수를 검증하고 RAG 시스템 설정을 중앙에서 관리합니다.
 *
 * 설정 분류:
 * - LLM 설정: 요약 및 인사말 생성용 모델
 * - 임베딩 설정: Titan V2 임베딩 모델
 * - 청킹 설정: Parent/Child 청크 크기
 * - 검색 설정: 유사도 임계값, 결과 개수
 * - 캐시 설정: Redis TTL
 * - Dense Summary 설정: 고밀도 요약 관련
 */
@Injectable()
export class RagConfig implements OnModuleInit {
  private readonly logger = new Logger(RagConfig.name);

  // ==========================================================================
  // LLM 설정
  // ==========================================================================
  readonly llmModel: string;
  readonly summaryModel: string;
  readonly summaryMaxTokens: number;
  readonly summaryRequestTimeoutMs: number;

  // ==========================================================================
  // 임베딩 설정
  // ==========================================================================
  readonly embeddingModel: string;
  readonly vectorDimensions: number;
  readonly bedrockMaxRetries: number;
  readonly bedrockRetryDelayMs: number;
  readonly bedrockRetryBackoffFactor: number;

  // ==========================================================================
  // Parent 청킹 설정 (v1 Raw)
  // ==========================================================================
  readonly chunkSize: number;
  readonly chunkOverlap: number;

  // ==========================================================================
  // Child 청킹 설정 (v1 Raw)
  // ==========================================================================
  readonly childChunkSize: number;
  readonly childChunkOverlap: number;

  // ==========================================================================
  // Dense Summary 청킹 설정 (v2)
  // ==========================================================================
  readonly contextualChunkSize: number;
  readonly contextualChunkMax: number;
  readonly maxInputChars: number;

  // ==========================================================================
  // 검색 설정
  // ==========================================================================
  readonly searchLimit: number;
  readonly similarityThreshold: number;
  readonly childSearchMultiplier: number;
  readonly windowContextChars: number;

  // ==========================================================================
  // 캐시 설정
  // ==========================================================================
  readonly redisCacheTtl: number;
  readonly redisGreetingTtl: number;
  readonly weeklyContextDays: number;

  // ==========================================================================
  // Greeting 설정
  // ==========================================================================
  readonly maxContextChars: number;
  readonly maxGreetingTokens: number;

  // ==========================================================================
  // 기능 플래그
  // ==========================================================================
  readonly useDenseSummary: boolean;
  readonly debugLogs: boolean;

  // ==========================================================================
  // 배치 처리 설정
  // ==========================================================================
  readonly embeddingBatchSize: number;

  constructor() {
    // LLM 설정
    this.llmModel =
      process.env.BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    this.summaryModel =
      process.env.BEDROCK_SUMMARY_MODEL ||
      process.env.BEDROCK_MODEL ||
      'anthropic.claude-3-5-sonnet-20241022-v2:0';
    this.summaryMaxTokens = this.parseIntSafe(
      process.env.SUMMARY_MAX_TOKENS,
      4000,
      'SUMMARY_MAX_TOKENS',
    );
    this.summaryRequestTimeoutMs = this.parseIntSafe(
      process.env.BEDROCK_SUMMARY_TIMEOUT_MS,
      30000,
      'BEDROCK_SUMMARY_TIMEOUT_MS',
    );

    // 임베딩 설정
    this.embeddingModel =
      process.env.EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
    this.vectorDimensions = this.parseIntSafe(
      process.env.VECTOR_DIMENSIONS,
      1024,
      'VECTOR_DIMENSIONS',
    );
    this.bedrockMaxRetries = this.parseIntSafe(
      process.env.BEDROCK_MAX_RETRIES,
      3,
      'BEDROCK_MAX_RETRIES',
    );
    this.bedrockRetryDelayMs = this.parseIntSafe(
      process.env.BEDROCK_RETRY_DELAY_MS,
      1000,
      'BEDROCK_RETRY_DELAY_MS',
    );
    this.bedrockRetryBackoffFactor = this.parseIntSafe(
      process.env.BEDROCK_RETRY_BACKOFF_FACTOR,
      2,
      'BEDROCK_RETRY_BACKOFF_FACTOR',
    );

    // Parent 청킹 설정 (v1)
    this.chunkSize = this.parseIntSafe(
      process.env.RAG_CHUNK_SIZE,
      500,
      'RAG_CHUNK_SIZE',
    );
    this.chunkOverlap = this.parseIntSafe(
      process.env.RAG_CHUNK_OVERLAP,
      50,
      'RAG_CHUNK_OVERLAP',
    );

    // Child 청킹 설정 (v1)
    this.childChunkSize = this.parseIntSafe(
      process.env.RAG_CHILD_CHUNK_SIZE,
      200,
      'RAG_CHILD_CHUNK_SIZE',
    );
    this.childChunkOverlap = this.parseIntSafe(
      process.env.RAG_CHILD_CHUNK_OVERLAP,
      50,
      'RAG_CHILD_CHUNK_OVERLAP',
    );

    // Dense Summary 청킹 설정 (v2)
    this.contextualChunkSize = this.parseIntSafe(
      process.env.RAG_CONTEXTUAL_CHUNK_SIZE,
      150,
      'RAG_CONTEXTUAL_CHUNK_SIZE',
    );
    this.contextualChunkMax = this.parseIntSafe(
      process.env.RAG_CONTEXTUAL_CHUNK_MAX,
      200,
      'RAG_CONTEXTUAL_CHUNK_MAX',
    );
    this.maxInputChars = this.parseIntSafe(
      process.env.RAG_MAX_INPUT_CHARS,
      15000,
      'RAG_MAX_INPUT_CHARS',
    );

    // 검색 설정
    this.searchLimit = this.parseIntSafe(
      process.env.RAG_SEARCH_LIMIT,
      5,
      'RAG_SEARCH_LIMIT',
    );
    this.similarityThreshold = this.parseFloatSafe(
      process.env.SIMILARITY_THRESHOLD,
      0.4,
      'SIMILARITY_THRESHOLD',
    );
    this.childSearchMultiplier = this.parseIntSafe(
      process.env.RAG_CHILD_SEARCH_MULTIPLIER,
      3,
      'RAG_CHILD_SEARCH_MULTIPLIER',
    );
    this.windowContextChars = this.parseIntSafe(
      process.env.RAG_WINDOW_CONTEXT_CHARS,
      150,
      'RAG_WINDOW_CONTEXT_CHARS',
    );

    // 캐시 설정
    this.redisCacheTtl = this.parseIntSafe(
      process.env.REDIS_CACHE_TTL,
      3600,
      'REDIS_CACHE_TTL',
    );
    this.redisGreetingTtl = this.parseIntSafe(
      process.env.REDIS_GREETING_TTL,
      600,
      'REDIS_GREETING_TTL',
    );
    this.weeklyContextDays = this.parseIntSafe(
      process.env.WEEKLY_CONTEXT_DAYS,
      7,
      'WEEKLY_CONTEXT_DAYS',
    );

    // Greeting 설정
    this.maxContextChars = 3000;
    this.maxGreetingTokens = 200;

    // 기능 플래그
    this.useDenseSummary = process.env.RAG_USE_DENSE_SUMMARY !== 'false';
    this.debugLogs = process.env.RAG_DEBUG_LOGS === 'true';

    // 배치 처리 설정
    this.embeddingBatchSize = 50;
  }

  async onModuleInit() {
    this.logger.log('='.repeat(60));
    this.logger.log('RAG Configuration initialized');
    this.logger.log('='.repeat(60));

    // LLM 설정 로그
    this.logger.log(`[LLM] Model: ${this.llmModel}`);
    this.logger.log(`[LLM] Summary Model: ${this.summaryModel}`);
    this.logger.log(`[LLM] Summary Max Tokens: ${this.summaryMaxTokens}`);
    this.logger.log(
      `[LLM] Summary Timeout: ${this.summaryRequestTimeoutMs}ms`,
    );

    // 임베딩 설정 로그
    this.logger.log(`[Embedding] Model: ${this.embeddingModel}`);
    this.logger.log(`[Embedding] Dimensions: ${this.vectorDimensions}`);
    this.logger.log(`[Embedding] Max Retries: ${this.bedrockMaxRetries}`);

    // 청킹 설정 로그
    this.logger.log(
      `[Chunking] Parent: ${this.chunkSize} chars (overlap: ${this.chunkOverlap})`,
    );
    this.logger.log(
      `[Chunking] Child: ${this.childChunkSize} chars (overlap: ${this.childChunkOverlap})`,
    );
    this.logger.log(
      `[Chunking] Contextual: ${this.contextualChunkSize}-${this.contextualChunkMax} chars`,
    );
    this.logger.log(`[Chunking] Max Input: ${this.maxInputChars} chars`);

    // 검색 설정 로그
    this.logger.log(`[Search] Limit: ${this.searchLimit}`);
    this.logger.log(`[Search] Similarity Threshold: ${this.similarityThreshold}`);
    this.logger.log(`[Search] Child Multiplier: ${this.childSearchMultiplier}`);
    this.logger.log(`[Search] Window Context: ${this.windowContextChars} chars`);

    // 캐시 설정 로그
    this.logger.log(`[Cache] Redis TTL: ${this.redisCacheTtl}s`);
    this.logger.log(`[Cache] Greeting TTL: ${this.redisGreetingTtl}s`);
    this.logger.log(`[Cache] Weekly Context Days: ${this.weeklyContextDays}`);

    // 기능 플래그 로그
    this.logger.log(`[Features] Dense Summary: ${this.useDenseSummary}`);
    this.logger.log(`[Features] Debug Logs: ${this.debugLogs}`);

    this.logger.log('='.repeat(60));
  }

  /**
   * 환경 변수를 안전하게 정수로 파싱
   */
  private parseIntSafe(
    value: string | undefined,
    defaultValue: number,
    name: string,
  ): number {
    if (!value) {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
      this.logger.warn(
        `Invalid ${name}: "${value}". Using default: ${defaultValue}`,
      );
      return defaultValue;
    }
    return parsed;
  }

  /**
   * 환경 변수를 안전하게 실수로 파싱
   */
  private parseFloatSafe(
    value: string | undefined,
    defaultValue: number,
    name: string,
  ): number {
    if (!value) {
      return defaultValue;
    }
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      this.logger.warn(
        `Invalid ${name}: "${value}". Using default: ${defaultValue}`,
      );
      return defaultValue;
    }
    return parsed;
  }
}
