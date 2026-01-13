import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessToken, type AccessTokenOptions } from 'livekit-server-sdk';
import { ConfigService } from '../core/config';
import { DbService } from '../database';
import { EventsService } from '../events/events.service';
import { LiveKitService } from '../integration/livekit/livekit.service';
import { RagService } from '../ai/rag.service';

type Role = 'host' | 'viewer' | 'observer';

export type RtcTokenResult = {
  livekitUrl: string;
  roomName: string;
  token: string;
  expiresAt: string;
  identity: string;
  name: string;
  role: Role;
  callId?: string;
};

export type DeviceInfo = {
  apnsToken?: string;
  voipToken?: string;
  platform?: string;
  env?: string;
  supportsCallKit?: boolean;
};

const AUTO_CALLER_IDENTITY = 'agent-auto';

@Injectable()
export class RtcTokenService {
  private readonly logger = new Logger(RtcTokenService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly dbService: DbService,
    private readonly eventsService: EventsService,
    private readonly liveKitService: LiveKitService,
    private readonly ragService: RagService,
  ) { }

  /**
   * Create an isolated LiveKit room for a bot participant (identity starting with "bot-")
   * and dispatch the existing voice agent (identity starting with "agent-") into the same room
   * so they can interact with each other.
   */
  async createBotWithAgent(): Promise<RtcTokenResult> {
    const config = this.configService.getConfig();
    const ttlSeconds = config.livekitTokenTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const roomName = `bot-${randomUUID()}`;
    const identity = `bot-${randomUUID()}`;
    const name = identity;
    const role: Role = 'host';

    this.logger.log(
      `createBotWithAgent room=${roomName} identity=${identity} role=${role}`,
    );

    // Dispatch voice agent
    try {
      await this.liveKitService.dispatchVoiceAgent(roomName, {
        identity,
        name,
        type: 'bot',
      });
    } catch (err) {
      this.logger.error(`Failed to dispatch voice agent: ${(err as Error).message}`);
    }

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
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: true,
      hidden: false,
    });

    return {
      livekitUrl: config.livekitPublicUrl,
      roomName,
      token: await accessToken.toJwt(),
      expiresAt,
      identity,
      name,
      role,
    };
  }

  async issueToken(params: {
    roomName: string;
    identity: string;
    name: string;
    role: Role;
    device?: DeviceInfo;
    isAuthenticated?: boolean;
  }): Promise<RtcTokenResult> {
    const config = this.configService.getConfig();
    const ttlSeconds = config.livekitTokenTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Generate unique room name for iOS users
    const isIosUser = !!(params.device?.apnsToken || params.device?.voipToken);
    const roomName = isIosUser ? `room-${randomUUID()}` : params.roomName;

    const deviceSummary = params.device
      ? `apns=${this.summarizeToken(params.device.apnsToken)} voip=${this.summarizeToken(params.device.voipToken)} env=${params.device.env ?? 'default'} platform=${params.device.platform ?? 'ios'}`
      : 'none';
    this.logger.log(
      `issueToken room=${roomName} (original=${params.roomName}, isIos=${isIosUser}) identity=${params.identity} role=${params.role} device=${deviceSummary}`,
    );

    let identity = params.identity;
    let name = params.name;
    let callId: string | null = null;

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

    // 인증된 경우만 upsert, 아니면 find만 (익명 사용자 생성 방지)
    let user;
    if (params.isAuthenticated) {
      user = await this.dbService.upsertUser(identity, name);
    } else {
      user = await this.dbService.findUserByIdentity(identity);
      if (!user) {
        this.logger.warn(
          `issueToken rejected - user not found identity=${identity} (login required)`,
        );
        throw new HttpException('로그인이 필요합니다', HttpStatus.UNAUTHORIZED);
      }
    }

    // Create room and add member for iOS users
    // Web admins don't create rooms, they only join existing rooms created by iOS users
    if (isIosUser) {
      // 용량 체크: 동시 통화 제한 및 중복 통화 방지
      const [activeCallCount, hasActiveCall, slotConfig] = await Promise.all([
        this.dbService.getActiveCallCount(),
        this.dbService.hasActiveCall(user.id),
        this.dbService.getSlotConfig(),
      ]);

      if (hasActiveCall) {
        this.logger.warn(
          `issueToken rejected - user already in call userId=${user.id}`,
        );
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'CALL_ALREADY_ACTIVE',
              message: '이미 진행 중인 통화가 있습니다.',
            },
          },
          HttpStatus.CONFLICT,
        );
      }

      if (activeCallCount >= slotConfig.maxConcurrentCalls) {
        this.logger.warn(
          `issueToken rejected - server at capacity current=${activeCallCount} max=${slotConfig.maxConcurrentCalls}`,
        );
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'SERVER_AT_CAPACITY',
              message: '현재 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.',
            },
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      await this.dbService.upsertRoomMember({
        roomName: roomName,
        userId: user.id,
        role: params.role,
      });
      this.logger.log(
        `Room and member created for iOS user identity=${identity} room=${roomName}`,
      );

      // Emit room created event for real-time updates
      this.eventsService.emitRoomEvent({
        type: 'room-created',
        roomName,
        identity,
        name,
      });

      // 🚀 PRE-WARM: Preload weekly context and generate personalized greeting BEFORE agent joins
      // This runs immediately when user requests a call, parallel with agent dispatch
      // By the time agent enters and subscribes to Redis, both context and greeting are likely ready
      const wardId = await this.dbService.findWardByUserId(user.id).then(w => w?.id);
      if (wardId) {
        this.logger.log(
          `🚀 Pre-warming weekly context and greeting for ward=${wardId} room=${roomName}`,
        );
        // Fire and forget - don't block token issuance
        Promise.allSettled([
          this.ragService.preloadWeeklyContext(wardId),
          this.ragService.generatePersonalizedGreeting(wardId, 'inbound'),
        ]).then(results => {
          const preloadResult = results[0];
          const greetingResult = results[1];

          if (preloadResult.status === 'rejected') {
            this.logger.warn(
              `Pre-warm weekly context failed ward=${wardId}: ${preloadResult.reason?.message || preloadResult.reason}`,
            );
          }

          if (greetingResult.status === 'rejected') {
            this.logger.warn(
              `Pre-warm greeting failed ward=${wardId}: ${greetingResult.reason?.message || greetingResult.reason}`,
            );
            this.ragService
              .cacheStandardGreeting(wardId, 'inbound')
              .catch(fallbackError => {
                this.logger.warn(
                  `Fallback greeting cache failed ward=${wardId}: ${fallbackError.message}`,
                );
              });
          }
        });
      }

      // Dispatch voice agent
      try {
        await this.liveKitService.dispatchVoiceAgent(roomName, {
          userId: user.id,
          identity,
          name,
        });

        // Schedule orphan room cleanup check after 15 seconds
        // If iOS user doesn't join, room will be cleaned up
        setTimeout(() => {
          this.liveKitService.closeRoomIfAdminOnly(roomName);
        }, 15000);
      } catch (err) {
        this.logger.error(`Failed to dispatch voice agent: ${(err as Error).message}`);
        throw new HttpException(
          'Voice agent dispatch failed',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      try {
        const call = await this.dbService.createCall({
          callerIdentity: AUTO_CALLER_IDENTITY,
          calleeIdentity: identity,
          calleeUserId: user.id,
          roomName,
        });
        callId = call.id;
        this.logger.log(
          `Auto call record created callId=${callId} room=${roomName} identity=${identity}`,
        );
      } catch (error) {
        this.logger.warn(
          `Auto call record failed room=${roomName} identity=${identity} error=${(
            error as Error
          ).message}`,
        );
      }
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
      hidden: params.role === 'host', // Admin은 다른 참가자에게 안 보임
    });

    const result = {
      livekitUrl: config.livekitPublicUrl,
      roomName: roomName,
      token: await accessToken.toJwt(),
      expiresAt,
      identity,
      name,
      role: params.role,
      callId: callId ?? undefined,
    };

    this.logger.log(
      `issueToken result: livekitUrl=${result.livekitUrl} roomName=${result.roomName} identity=${result.identity}`,
    );

    return result;
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
