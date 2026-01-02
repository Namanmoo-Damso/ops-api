import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessToken, type AccessTokenOptions } from 'livekit-server-sdk';
import { ConfigService } from '../core/config';
import { DbService } from '../database';
import { EventsService } from '../events/events.service';

type Role = 'host' | 'viewer' | 'observer';

export type RtcTokenResult = {
  livekitUrl: string;
  roomName: string;
  token: string;
  expiresAt: string;
  identity: string;
  name: string;
  role: Role;
};

export type DeviceInfo = {
  apnsToken?: string;
  voipToken?: string;
  platform?: string;
  env?: string;
  supportsCallKit?: boolean;
};

@Injectable()
export class RtcTokenService {
  private readonly logger = new Logger(RtcTokenService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: DbService,
    private readonly eventsService: EventsService,
  ) {}

  async issueToken(params: {
    roomName: string;
    identity: string;
    name: string;
    role: Role;
    device?: DeviceInfo;
  }): Promise<RtcTokenResult> {
    const config = this.configService.getConfig();
    const ttlSeconds = config.livekitTokenTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const roomName = params.roomName;

    const deviceSummary = params.device
      ? `apns=${this.summarizeToken(params.device.apnsToken)} voip=${this.summarizeToken(params.device.voipToken)} env=${params.device.env ?? 'default'} platform=${params.device.platform ?? 'ios'}`
      : 'none';
    this.logger.log(
      `issueToken room=${roomName} identity=${params.identity} role=${params.role} device=${deviceSummary}`,
    );

    let identity = params.identity;
    let name = params.name;

    // Find existing user by device token
    const candidates: Array<{ tokenType: 'apns' | 'voip'; token: string }> = [];
    if (params.device?.voipToken) {
      candidates.push({
        tokenType: 'voip',
        token: params.device.voipToken.trim(),
      });
    }
    if (params.device?.apnsToken) {
      candidates.push({
        tokenType: 'apns',
        token: params.device.apnsToken.trim(),
      });
    }
    for (const candidate of candidates) {
      if (!candidate.token) continue;
      const existing = await this.dbService.findUserByDeviceToken(candidate);
      if (existing) {
        identity = existing.identity;
        name = existing.display_name ?? name;
        this.logger.log(
          `issueToken identity override via ${candidate.tokenType} -> ${identity}`,
        );
        break;
      }
    }

    // Upsert user
    const user = await this.dbService.upsertUser(identity, name);

    // [방 생성 권한 분리]
    // iOS 사용자(어르신/보호자): 새 방을 생성하고 AI Agent를 자동으로 호출
    // 웹 관제센터: 기존 방에만 참여 (방 생성 안함)
    const isIosUser = !!(params.device?.apnsToken || params.device?.voipToken);
    if (isIosUser) {
      await this.dbService.upsertRoomMember({
        roomName: roomName,
        userId: user.id,
        role: params.role,
      });
      this.logger.log(
        `Room and member created for iOS user identity=${identity} room=${roomName}`,
      );

      // [실시간 이벤트 발행]
      // room-created 이벤트를 발행하여 Auto-dispatch 로직이 AI Agent를 투입하도록 트리거
      this.eventsService.emitRoomEvent({
        type: 'room-created',
        roomName,
        identity,
        name,
      });
    } else {
      // Web admin - don't create room, just log
      this.logger.log(
        `Web admin token issued without room creation identity=${identity} room=${roomName}`,
      );
    }

    // Register device if provided
    if (params.device?.apnsToken || params.device?.voipToken) {
      await this.registerDevice({
        identity,
        displayName: name,
        platform: params.device.platform ?? 'ios',
        env: params.device.env,
        apnsToken: params.device.apnsToken,
        voipToken: params.device.voipToken,
        supportsCallKit: params.device.supportsCallKit,
      });
    }

    // Generate LiveKit token
    const options: AccessTokenOptions = {
      identity,
      name,
      ttl: ttlSeconds,
    };
    const accessToken = new AccessToken(
      config.livekitApiKey,
      config.livekitApiSecret,
      options,
    );

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: params.role !== 'observer',
      canSubscribe: true,
      canPublishData: params.role !== 'observer',
      roomAdmin: params.role === 'host',
    });

    // Use automatic agent dispatch (no explicit configuration needed)
    // The agent worker will automatically join any new room

    return {
      livekitUrl: config.livekitUrl,
      roomName: roomName,
      token: await accessToken.toJwt(),
      expiresAt,
      identity,
      name,
      role: params.role,
    };
  }

  private async registerDevice(params: {
    identity: string;
    displayName?: string;
    platform: string;
    env?: string;
    apnsToken?: string;
    voipToken?: string;
    supportsCallKit?: boolean;
  }) {
    if (!params.apnsToken && !params.voipToken) {
      return;
    }
    const env = this.configService.normalizeEnv(
      params.env ?? this.configService.apnsDefaultEnv,
    );
    this.logger.log(
      `registerDevice identity=${params.identity} env=${env} supportsCallKit=${params.supportsCallKit ?? true} apns=${this.summarizeToken(params.apnsToken)} voip=${this.summarizeToken(params.voipToken)}`,
    );
    return this.dbService.upsertDevice({
      identity: params.identity,
      displayName: params.displayName,
      platform: params.platform,
      env,
      apnsToken: params.apnsToken,
      voipToken: params.voipToken,
      supportsCallKit: params.supportsCallKit,
    });
  }

  private summarizeToken(token?: string): string {
    if (!token) return 'none';
    const suffix = token.slice(-6);
    return `len=${token.length}..${suffix}`;
  }
}
