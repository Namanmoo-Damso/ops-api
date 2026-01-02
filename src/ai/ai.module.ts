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
        const providerType = process.env.AI_PROVIDER || 'bedrock';
        const maxTokens = parseInt(process.env.AI_MAX_TOKENS || '1000', 10);
        const instruction =
          process.env.AI_INSTRUCTION || DEFAULT_AI_INSTRUCTION;
        const systemPrompt = `${instruction}\n${AI_RESPONSE_SCHEMA}`;

        if (providerType === 'bedrock') {
          return new BedrockProvider(
            process.env.AWS_REGION,
            process.env.AWS_ACCESS_KEY_ID,
            process.env.AWS_SECRET_ACCESS_KEY,
            process.env.BEDROCK_MODEL,
            maxTokens,
            systemPrompt,
          );
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
