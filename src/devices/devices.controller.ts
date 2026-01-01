import {
  Controller,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { AuthService } from '../auth';
import { ConfigService } from '../core/config';

@Controller('v1/devices')
export class DevicesController {
  private readonly logger = new Logger(DevicesController.name);

  constructor(
    private readonly devicesService: DevicesService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private summarizeToken(token: string | undefined): string {
    if (!token) return 'none';
    const len = token.length;
    if (len <= 8) return `${len}c`;
    return `${token.slice(0, 4)}..${token.slice(-4)}`;
  }

  @Post('register')
  async registerDevice(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      identity?: string;
      displayName?: string;
      platform?: string;
      env?: 'prod' | 'sandbox';
      apnsToken?: string;
      voipToken?: string;
      supportsCallKit?: boolean;
    },
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const identity = body.identity?.trim() || auth?.identity;
    if (!identity) {
      throw new HttpException('identity is required', HttpStatus.BAD_REQUEST);
    }

    const displayName = body.displayName?.trim() || auth?.displayName;
    const platform = body.platform?.trim() || 'ios';
    const env = body.env;
    const supportsCallKit = body.supportsCallKit ?? true;

    if (env && !['prod', 'sandbox'].includes(env)) {
      throw new HttpException('invalid env', HttpStatus.BAD_REQUEST);
    }

    try {
      this.logger.log(
        `registerDevice identity=${identity} platform=${platform} env=${env ?? 'default'} supportsCallKit=${supportsCallKit} apns=${this.summarizeToken(body.apnsToken)} voip=${this.summarizeToken(body.voipToken)}`,
      );
      return await this.devicesService.registerDevice({
        identity,
        displayName,
        platform,
        env,
        apnsToken: body.apnsToken,
        voipToken: body.voipToken,
        supportsCallKit,
      });
    } catch (error) {
      this.logger.warn(
        `registerDevice failed identity=${identity} error=${(error as Error).message}`,
      );
      throw new HttpException(
        (error as Error).message || 'Bad request',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
