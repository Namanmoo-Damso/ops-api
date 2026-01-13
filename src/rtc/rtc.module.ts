import { Module } from '@nestjs/common';
import { RtcController } from './rtc.controller';
import { RtcTokenService } from './rtc-token.service';
import { CallsModule } from '../calls';
import { AiModule } from '../ai';

@Module({
  imports: [CallsModule, AiModule],
  controllers: [RtcController],
  providers: [RtcTokenService],
  exports: [RtcTokenService],
})
export class RtcModule {}
