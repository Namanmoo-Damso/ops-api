import { Module, Global } from '@nestjs/common';
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

// AI Providers
import { OpenAiProvider } from './providers/openai.provider';
import { BedrockProvider } from './providers/bedrock.provider';
import { DEFAULT_AI_INSTRUCTION, AI_RESPONSE_SCHEMA } from './ai.constants';

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
 * - RagSearchService: PGVector 검색
 * - RagCacheService: Redis 캐시 관리
 * - RagMetricsService: 성능 메트릭 추적
 *
 * @Global() 데코레이터로 전역 모듈로 등록
 */
@Global()
@Module({
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
  exports: [AiService, RagService, TranscriptStore],
})
export class AiModule {}
