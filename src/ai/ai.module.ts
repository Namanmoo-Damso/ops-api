import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { OpenAiProvider } from './providers/openai.provider';

export const AI_PROVIDER = 'AI_PROVIDER';

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
      provide: AI_PROVIDER,
      useFactory: () => {
        return new OpenAiProvider(process.env.OPENAI_API_KEY);
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
