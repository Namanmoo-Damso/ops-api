import { Injectable, Logger } from '@nestjs/common';
import { AccessToken, type AccessTokenOptions } from 'livekit-server-sdk';
import { ConfigService } from '../core/config';
import { DbService } from '../database';

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

    const deviceSummary = params.device
      ? `apns=${this.summarizeToken(params.device.apnsToken)} voip=${this.summarizeToken(params.device.voipToken)} env=${params.device.env ?? 'default'} platform=${params.device.platform ?? 'ios'}`
      : 'none';
    this.logger.log(
      `issueToken room=${params.roomName} identity=${params.identity} role=${params.role} device=${deviceSummary}`,
    );

    let identity = params.identity;
    let name = params.name;

    // Find existing user by device token
    const candidates: Array<{ tokenType: 'apns' | 'voip'; token: string }> = [];
    if (params.device?.voipToken) {
      candidates.push({ tokenType: 'voip', token: params.device.voipToken.trim() });
    }
    if (params.device?.apnsToken) {
      candidates.push({ tokenType: 'apns', token: params.device.apnsToken.trim() });
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

    // Upsert user and room member
    const user = await this.dbService.upsertUser(identity, name);
    await this.dbService.upsertRoomMember({
      roomName: params.roomName,
      userId: user.id,
      role: params.role,
    });

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
      room: params.roomName,
      canPublish: params.role !== 'observer',
      canSubscribe: true,
      canPublishData: params.role !== 'observer',
      roomAdmin: params.role === 'host',
    });

    return {
      livekitUrl: config.livekitUrl,
      roomName: params.roomName,
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
    const env = this.configService.normalizeEnv(params.env ?? this.configService.apnsDefaultEnv);
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
