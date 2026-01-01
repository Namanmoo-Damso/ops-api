import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';

/**
 * AI 모듈
 *
 * OpenAI 기반 통화 분석, 건강 키워드 추출 등 AI 기능을 제공합니다.
 * @Global() 데코레이터로 전역 모듈로 등록
 */
@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
