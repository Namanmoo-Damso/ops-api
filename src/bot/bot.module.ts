import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { ConfigModule } from '../core/config';
import { LiveKitModule } from '../integration/livekit';
import { DatabaseModule } from '../database';

@Module({
  imports: [ConfigModule, LiveKitModule, DatabaseModule],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
