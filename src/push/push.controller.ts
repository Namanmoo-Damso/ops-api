import {
  Controller,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { CallsService } from '../calls';
import { AuthService } from '../auth';
import { ConfigService } from '../core/config';

@Controller('v1/push')
export class PushController {
  private readonly logger = new Logger(PushController.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private summarizePayloadKeys(payload: Record<string, unknown> | undefined): string {
    if (!payload) return 'none';
    const keys = Object.keys(payload);
    if (keys.length === 0) return 'empty';
    return keys.join(',');
  }

  @Post('broadcast')
  async pushBroadcast(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      type?: 'alert' | 'voip';
      title?: string;
      body?: string;
      payload?: Record<string, unknown>;
      env?: 'prod' | 'sandbox';
    },
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const type = body.type ?? 'alert';
    if (!['alert', 'voip'].includes(type)) {
      throw new HttpException('invalid type', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `pushBroadcast type=${type} env=${body.env ?? 'default'} payloadKeys=${this.summarizePayloadKeys(body.payload)}`,
    );
    return await this.callsService.sendBroadcastPush({
      type,
      title: body.title,
      body: body.body,
      payload: body.payload,
      env: body.env,
    });
  }

  @Post('user')
  async pushUser(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      identity?: string;
      type?: 'alert' | 'voip';
      title?: string;
      body?: string;
      payload?: Record<string, unknown>;
      env?: 'prod' | 'sandbox';
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

    const type = body.type ?? 'alert';
    if (!['alert', 'voip'].includes(type)) {
      throw new HttpException('invalid type', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `pushUser identity=${identity} type=${type} env=${body.env ?? 'default'} payloadKeys=${this.summarizePayloadKeys(body.payload)}`,
    );
    return await this.callsService.sendUserPush({
      identity,
      type,
      title: body.title,
      body: body.body,
      payload: body.payload,
      env: body.env,
    });
  }
}
