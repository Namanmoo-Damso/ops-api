import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { RtcTokenService } from './rtc-token.service';
import { AuthService } from '../auth';
import { DbService } from '../database';
import { ConfigService } from '../core/config';
import { CallsService } from '../calls';
import { LiveKitService } from '../integration/livekit';

@Controller()
export class RtcController {
  private readonly logger = new Logger(RtcController.name);

  constructor(
    private readonly rtcTokenService: RtcTokenService,
    private readonly authService: AuthService,
    private readonly dbService: DbService,
    private readonly configService: ConfigService,
    private readonly callsService: CallsService,
    private readonly liveKitService: LiveKitService,
  ) {}

  private normalizeLivekitUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const trimmed = url.trim();
    if (!trimmed.startsWith('wss://') && !trimmed.startsWith('ws://')) {
      return undefined;
    }
    return trimmed.replace(/\/+$/, '');
  }

  private summarizeToken(token: string | undefined): string {
    if (!token) return 'none';
    const len = token.length;
    if (len <= 8) return `${len}c`;
    return `${token.slice(0, 4)}..${token.slice(-4)}`;
  }

  @Get('v1/rooms/:roomName/members')
  async listMembers(
    @Headers('authorization') authorization: string | undefined,
    @Param('roomName') roomNameParam: string,
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const roomName = roomNameParam?.trim();
    if (!roomName) {
      throw new HttpException('roomName is required', HttpStatus.BAD_REQUEST);
    }

    const members = await this.callsService.listRoomMembers(roomName);
    this.logger.log(`listMembers room=${roomName} count=${members.length}`);
    return { roomName, members };
  }

  @Post('v1/rtc/token')
  async issueToken(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      roomName?: string;
      identity?: string;
      name?: string;
      role?: 'host' | 'viewer' | 'observer';
      livekitUrl?: string;
      apnsToken?: string;
      voipToken?: string;
      platform?: string;
      env?: 'prod' | 'sandbox';
      supportsCallKit?: boolean;
    },
  ) {
    const config = this.configService.getConfig();
    const authHeader = authorization ?? '';
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    let authIdentity: string | undefined;
    let authName: string | undefined;

    if (bearer) {
      // Try Kakao auth first (mobile users - guardians/wards)
      const kakaoPayload = this.authService.verifyAccessToken(bearer);
      if (kakaoPayload) {
        const user = await this.dbService.findUserById(kakaoPayload.sub);
        if (user) {
          authIdentity = user.identity;
          authName = user.nickname ?? user.display_name ?? undefined;
        }
      } else {
        // Try admin auth (web users - ops dashboard)
        try {
          const adminPayload = this.authService.verifyAdminAccessToken(bearer);
          const admin = await this.dbService.findAdminById(adminPayload.sub);
          if (admin && admin.is_active) {
            authIdentity = `admin_${admin.id}`;
            authName = admin.name ?? admin.email;
            this.logger.log(
              `issueToken admin authenticated id=${admin.id} email=${admin.email}`,
            );
          } else {
            throw new Error('Admin not found or inactive');
          }
        } catch (adminError) {
          // Fall back to API token (anonymous auth)
          try {
            const payload = this.authService.verifyApiToken(bearer);
            authIdentity = payload.identity;
            authName = payload.displayName;
          } catch {
            if (config.authRequired) {
              throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
            }
          }
        }
      }
    } else if (config.authRequired) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const roomName = body.roomName?.trim();
    if (!roomName) {
      throw new HttpException('roomName is required', HttpStatus.BAD_REQUEST);
    }

    // 인증된 사용자가 있으면 항상 그 identity를 사용 (일관성 유지)
    const identity = (authIdentity ?? body.identity)?.trim();
    if (!identity) {
      throw new HttpException('identity is required', HttpStatus.BAD_REQUEST);
    }

    const name = (authName ?? body.name ?? identity).trim();
    const role = body.role ?? 'viewer';

    if (!['host', 'viewer', 'observer'].includes(role)) {
      throw new HttpException('invalid role', HttpStatus.BAD_REQUEST);
    }

    const livekitUrlOverride = this.normalizeLivekitUrl(body.livekitUrl);
    if (body.livekitUrl && !livekitUrlOverride) {
      throw new HttpException('invalid livekitUrl', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `issueToken room=${roomName} identity=${identity} role=${role} env=${body.env ?? 'default'} livekit=${livekitUrlOverride ?? 'default'} apns=${this.summarizeToken(body.apnsToken)} voip=${this.summarizeToken(body.voipToken)}`,
    );

    const rtcData = await this.rtcTokenService.issueToken({
      roomName,
      identity,
      name,
      role,
      device:
        body.apnsToken ||
        body.voipToken ||
        body.platform ||
        body.env ||
        body.supportsCallKit !== undefined
          ? {
              apnsToken: body.apnsToken?.trim(),
              voipToken: body.voipToken?.trim(),
              platform: body.platform?.trim(),
              env: body.env,
              supportsCallKit: body.supportsCallKit,
            }
          : undefined,
      isAuthenticated: !!authIdentity,
    });

    return {
      ...rtcData,
      livekitUrl: livekitUrlOverride ?? rtcData.livekitUrl,
    };
  }

  @Get('v1/livekit/rooms')
  async listLivekitRooms(
    @Headers('authorization') authorization: string | undefined,
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    try {
      const summary = await this.liveKitService.getRoomsSummary();
      this.logger.log(
        `listLivekitRooms rooms=${summary.totalRooms} participants=${summary.totalParticipants}`,
      );
      return summary;
    } catch (error) {
      this.logger.warn(
        `listLivekitRooms failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to query LiveKit rooms',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
