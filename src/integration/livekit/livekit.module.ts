import { Global, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { json } from 'body-parser';
import { LiveKitService } from './livekit.service';
import { LiveKitWebhookController } from './livekit-webhook.controller';
import { AiModule } from '../../ai/ai.module';

@Global()
@Module({
  imports: [AiModule],
  controllers: [LiveKitWebhookController],
  providers: [LiveKitService],
  exports: [LiveKitService],
})
export class LiveKitModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply JSON body parser that accepts application/webhook+json for webhook routes
    consumer
      .apply(json({ type: ['application/json', 'application/webhook+json'] }))
      .forRoutes('webhook/livekit');
  }
}
