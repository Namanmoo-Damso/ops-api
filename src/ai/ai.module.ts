import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiService } from './ai.service';
import { AiAnalysisProvider } from './ai.interface';
import { TranscriptStore } from './transcript.store';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';

// RAG 서브 서비스들
import { RagConfig } from './rag/rag.config';
import { RagProcessor } from './rag/rag.processor';
import { RagRepository } from './rag/rag.repository';
import { RagEmbeddingService } from './rag/rag.embedding.service';
import { RagSearchService } from './rag/rag.search.service';
import { RagCacheService } from './rag/rag.cache.service';
import { RagMetricsService } from './rag/rag.metrics.service';
import { RagSummaryService } from './rag/rag.summary.service';

// Hybrid Search 서비스들
import { RagSearchRepository } from './rag/rag.search.repository';
import { RagRankFusionService } from './rag/rag.rank-fusion.service';
import { RagHybridSearchService } from './rag/rag.hybrid-search.service';
import { KoreanQueryProcessor } from './rag/rag.korean-query.processor';

// RAG Queue (BullMQ 기반 인덱싱 큐)
import { RagQueueModule } from './rag-queue/rag-queue.module';
import { RagIndexingProducer } from './rag-queue/rag-indexing.producer';
import { RAG_INDEXING_QUEUE } from './rag-queue/rag-queue.constants';

// AI Providers
import { OpenAiProvider } from './providers/openai.provider';
import { BedrockProvider } from './providers/bedrock.provider';
import { DEFAULT_AI_INSTRUCTION, AI_RESPONSE_SCHEMA } from './ai.constants';

/**
 * Redis URL 파싱 유틸리티
 */
function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 6379,
    password: parsed.password || undefined,
  };
}

/**
 * AI 모듈
 *
 * OpenAI 기반 통화 분석, 건강 키워드 추출 등 AI 기능을 제공합니다.
 * RAG (Retrieval-Augmented Generation) 기능 포함
 *
 * RAG 서비스 아키텍처:
 * - RagService: Orchestrator (전체 흐름 조율)
 * - RagConfig: 환경 변수 검증 및 설정 관리
 * - RagProcessor: 요약 생성 + 청킹 + 임베딩 로직
 * - RagRepository: DB CRUD (Parent-Child 트랜잭션)
 * - RagSummaryService: LLM 기반 고밀도 요약 생성
 * - RagEmbeddingService: Bedrock Titan 임베딩 생성
 * - RagSearchService: 하이브리드 검색 (Vector + FTS + RRF)
 * - RagCacheService: Redis 캐시 관리
 * - RagMetricsService: 성능 메트릭 추적
 *
 * Hybrid Search 아키텍처:
 * - RagSearchRepository: Vector 및 FTS 쿼리 실행
 * - RagRankFusionService: RRF 알고리즘 구현
 * - RagHybridSearchService: 병렬 검색 오케스트레이션
 *
 * @Global() 데코레이터로 전역 모듈로 등록
 */
@Global()
@Module({
  imports: [
    // BullMQ 전역 설정 (Redis 연결)
    BullModule.forRoot({
      connection: parseRedisUrl(
        process.env.REDIS_URL || 'redis://localhost:6379',
      ),
    }),
    // RAG 인덱싱 큐 등록
    BullModule.registerQueue({
      name: RAG_INDEXING_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
          count: 5000,
        },
      },
    }),
    // RagQueueModule (Bull Board UI 마운트)
    RagQueueModule,
  ],
  controllers: [RagController],
  providers: [
    AiService,
    TranscriptStore,
    RagService,

    // RAG 핵심 서비스
    RagConfig,
    RagProcessor,
    RagRepository,

    // RAG 인프라 서비스
    RagEmbeddingService,
    RagSearchService,
    RagCacheService,
    RagMetricsService,
    RagSummaryService,

    // Hybrid Search 서비스 (Vector + FTS + RRF)
    RagSearchRepository,
    RagRankFusionService,
    RagHybridSearchService,
    KoreanQueryProcessor,

    // AI Analysis Provider (Factory)
    {
      provide: AiAnalysisProvider,
      useFactory: () => {
        const providerType = process.env.AI_PROVIDER || 'openai';
        const validProviders = ['bedrock', 'openai'];

        if (!validProviders.includes(providerType)) {
          throw new Error(
            `Invalid AI_PROVIDER: ${providerType}. Must be one of: ${validProviders.join(', ')}`,
          );
        }

        const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '2000', 10);
        if (isNaN(maxTokens) || maxTokens <= 0) {
          throw new Error(
            `Invalid AI_MAX_TOKENS: ${process.env.AI_MAX_TOKENS}. Must be a positive number.`,
          );
        }

        const instruction =
          process.env.AI_INSTRUCTION || DEFAULT_AI_INSTRUCTION;
        const systemPrompt = `${instruction}\n${AI_RESPONSE_SCHEMA}`;

        if (providerType === 'bedrock') {
          if (!process.env.AWS_REGION) {
            throw new Error('AWS_REGION is required for Bedrock provider');
          }
          return new BedrockProvider(
            process.env.AWS_REGION,
            process.env.AWS_ACCESS_KEY_ID,
            process.env.AWS_SECRET_ACCESS_KEY,
            process.env.BEDROCK_MODEL,
            maxTokens,
            systemPrompt,
          );
        }

        if (!process.env.OPENAI_API_KEY) {
          throw new Error('OPENAI_API_KEY is required for OpenAI provider');
        }

        return new OpenAiProvider(
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_MODEL,
          maxTokens,
          systemPrompt,
        );
      },
    },
  ],
  exports: [AiService, RagService, TranscriptStore, RagQueueModule],
})
export class AiModule {}
