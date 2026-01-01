import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WardsService } from './wards.service';
import { AuthService } from '../auth';

@Controller('v1/ward')
export class WardsController {
  private readonly logger = new Logger(WardsController.name);

  constructor(
    private readonly wardsService: WardsService,
    private readonly authService: AuthService,
  ) {}

  private verifyAuthHeader(authorization: string | undefined) {
    const authHeader = authorization ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;

    if (!token) {
      throw new HttpException('Access token is required', HttpStatus.UNAUTHORIZED);
    }

    const payload = this.authService.verifyAccessToken(token);
    if (!payload) {
      throw new HttpException('Invalid or expired access token', HttpStatus.UNAUTHORIZED);
    }

    return payload;
  }

  @Get('settings')
  async getSettings(@Headers('authorization') authorization: string | undefined) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.wardsService.getSettings(payload.sub);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getSettings failed error=${(error as Error).message}`);
      throw new HttpException('Failed to get ward settings', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('settings')
  async updateSettings(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: {
      aiPersona?: string;
      weeklyCallCount?: number;
      callDurationMinutes?: number;
    },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.wardsService.updateSettings(payload.sub, {
        aiPersona: body.aiPersona,
        weeklyCallCount: body.weeklyCallCount,
        callDurationMinutes: body.callDurationMinutes,
      });
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`updateSettings failed error=${(error as Error).message}`);
      throw new HttpException('Failed to update ward settings', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('location')
  async updateLocation(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      timestamp?: string;
    },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    if (body.latitude === undefined || body.longitude === undefined) {
      throw new HttpException('latitude and longitude are required', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.wardsService.updateLocation(payload.sub, {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        timestamp: body.timestamp,
      });
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn('updateLocation failed error=' + (error as Error).message);
      throw new HttpException('Failed to update location', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('emergency')
  async triggerEmergency(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: {
      type: string;
      message?: string;
      latitude?: number;
      longitude?: number;
      accuracy?: number;
    },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.wardsService.triggerEmergency(payload.sub, {
        type: body.type || 'manual',
        message: body.message,
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      });
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn('triggerEmergency failed error=' + (error as Error).message);
      throw new HttpException('Failed to trigger emergency', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
