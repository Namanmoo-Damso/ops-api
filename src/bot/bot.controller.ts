import {
  Controller,
  Post,
  Body,
  Logger,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { BotService } from './bot.service';

@Controller('v1/bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(private readonly botService: BotService) {}

  /**
   * POST /bot/create
   *
   * Create a bot participant and dispatch a voice agent for testing purposes.
   * Optionally pass a userId to simulate a real user with their ward data.
   *
   * Request body:
   * - userId (optional): User ID (UUID) or identity (e.g., "kakao_123456") to simulate
   * - botId (optional): Bot ID (e.g., "0", "1") for identity like "bot-0" instead of random UUID
   *
   * Example:
   * curl -X POST http://localhost:3100/bot/create -H "Content-Type: application/json" -d '{"userId": "kakao_123456", "botId": "0"}'
   */
  @Post('create')
  async createBotWithAgent(@Body() body: { userId?: string; botId?: string }) {
    try {
      const result = await this.botService.createBotWithAgent({
        userId: body.userId?.trim(),
        botId: body.botId?.trim(),
      });
      this.logger.log(
        `createBotWithAgent room=${result.roomName} identity=${result.identity} wardId=${result.wardId ?? 'none'}`,
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `createBotWithAgent failed: ${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to create bot with agent',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
