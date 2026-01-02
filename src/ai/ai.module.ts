import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiAnalysisProvider } from './ai.interface';
import { OpenAiProvider } from './providers/openai.provider';
import { BedrockProvider } from './providers/bedrock.provider';
import { DEFAULT_AI_INSTRUCTION, AI_RESPONSE_SCHEMA } from './ai.constants';

/**
 * AI 모듈
 *
 * OpenAI 기반 통화 분석, 건강 키워드 추출 등 AI 기능을 제공합니다.
 * @Global() 데코레이터로 전역 모듈로 등록
 */
@Global()
@Module({
  providers: [
    AiService,
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
  exports: [AiService],
})
export class AiModule {}
