/**
 * Worker Module
 *
 * RAG 인덱싱 워커 전용 모듈
 * HTTP 서버 없이 프로세서만 동작하는 경량 컨텍스트
 *
 * 포함 모듈:
 * - BullMQ 연결 설정
 * - RAG Queue 프로세서
 * - Database 연결 (Prisma)
 * - Redis 연결 (TranscriptStore)
 * - AI/RAG 서비스 (인덱싱 로직)
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

// Core 모듈
import { ConfigModule } from './core/config';
import { CommonModule } from './common';
import { DatabaseModule } from './database';
import { PrismaModule } from './prisma';

// AI 모듈 (RAG 서비스 포함)
import { AiService } from './ai/ai.service';
import { AiAnalysisProvider } from './ai/ai.interface';
import { TranscriptStore } from './ai/transcript.store';
import { RagService } from './ai/rag.service';

// RAG 서브 서비스들
import { RagConfig } from './ai/rag/rag.config';
import { RagProcessor } from './ai/rag/rag.processor';
import { RagRepository } from './ai/rag/rag.repository';
import { RagEmbeddingService } from './ai/rag/rag.embedding.service';
import { RagSearchService } from './ai/rag/rag.search.service';
import { RagCacheService } from './ai/rag/rag.cache.service';
import { RagMetricsService } from './ai/rag/rag.metrics.service';
import { RagSummaryService } from './ai/rag/rag.summary.service';

// Hybrid Search 서비스들
import { RagSearchRepository } from './ai/rag/rag.search.repository';
import { RagRankFusionService } from './ai/rag/rag.rank-fusion.service';
import { RagHybridSearchService } from './ai/rag/rag.hybrid-search.service';
import { KoreanQueryProcessor } from './ai/rag/rag.korean-query.processor';

// AI Provider
import { OpenAiProvider } from './ai/providers/openai.provider';
import { BedrockProvider } from './ai/providers/bedrock.provider';
import { DEFAULT_AI_INSTRUCTION, AI_RESPONSE_SCHEMA } from './ai/ai.constants';

// RAG Queue (프로세서만 등록)
import { RagIndexingProcessor } from './ai/rag-queue/rag-indexing.processor';
import { RAG_INDEXING_QUEUE } from './ai/rag-queue/rag-queue.constants';

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

@Module({
  imports: [
    // 전역 설정 모듈
    ConfigModule,
    CommonModule,
    DatabaseModule,
    PrismaModule,

    // BullMQ 전역 설정 (Redis 연결)
    BullModule.forRoot({
      connection: parseRedisUrl(process.env.REDIS_URL || 'redis://localhost:6379'),
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
  ],
  providers: [
    // AI 서비스
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

    // Hybrid Search 서비스
    RagSearchRepository,
    RagRankFusionService,
    RagHybridSearchService,
    KoreanQueryProcessor,

    // AI Provider Factory
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

        const instruction = process.env.AI_INSTRUCTION || DEFAULT_AI_INSTRUCTION;
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

    // RAG 인덱싱 프로세서 (워커 핵심)
    RagIndexingProcessor,
  ],
})
export class WorkerModule {}
