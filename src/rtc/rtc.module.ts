import { Module } from '@nestjs/common';
import { RtcController } from './rtc.controller';
import { RtcTokenService } from './rtc-token.service';

@Module({
  controllers: [RtcController],
  providers: [RtcTokenService],
  exports: [RtcTokenService],
})
export class RtcModule {}
