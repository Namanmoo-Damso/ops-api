import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccessToken, type AccessTokenOptions } from 'livekit-server-sdk';
import { ConfigService } from '../core/config';
import { LiveKitService } from '../integration/livekit/livekit.service';
import { DbService } from '../database';

type Role = 'host' | 'viewer' | 'observer';

export type BotTokenResult = {
  livekitUrl: string;
  roomName: string;
  token: string;
  expiresAt: string;
  identity: string;
  name: string;
  role: Role;
  // Additional context for debugging
  userId?: string;
  wardId?: string;
  callId?: string;
  latitude?: string;
  longitude?: string;
};

export type CreateBotParams = {
  /** User ID (UUID) or identity (e.g., "kakao_123456") to simulate */
  userId?: string;
  /** Bot ID (e.g., "0", "1", "test") - used to create identity like "bot-0" instead of random UUID */
  botId?: string;
};

// Default Seoul coordinates for testing
const DEFAULT_LATITUDE = '37.5665';
const DEFAULT_LONGITUDE = '126.9780';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly liveKitService: LiveKitService,
    private readonly dbService: DbService,
  ) {}

  /**
   * Create an isolated LiveKit room for bot testing with a real user's data.
   *
   * This simulates a real user joining a room by:
   * 1. Looking up the user and their ward data from the database
   * 2. Creating a call record for proper transcript/summary storage
   * 3. Dispatching the agent with all necessary metadata (wardId, callId, location)
   *
   * @param params.userId - User ID (UUID) or identity to simulate. If not provided, creates a minimal bot session.
   */
  async createBotWithAgent(params?: CreateBotParams): Promise<BotTokenResult> {
    const config = this.configService.getConfig();
    const ttlSeconds = config.livekitTokenTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Use botId if provided, otherwise generate UUID
    const botSuffix = params?.botId ?? randomUUID();
    const roomName = `bot-${botSuffix}`;
    const role: Role = 'host';

    // Context to pass to agent
    let userId: string | undefined;
    let wardId: string | undefined;
    let callId: string | undefined;
    let latitude: string | undefined = DEFAULT_LATITUDE;
    let longitude: string | undefined = DEFAULT_LONGITUDE;
    let identity: string;
    let name: string;

    if (params?.userId) {
      // Lookup user by ID or identity
      const user = await this.findUser(params.userId);
      if (!user) {
        throw new HttpException(
          `User not found: ${params.userId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      userId = user.id;
      identity = user.identity;
      name = user.display_name ?? user.nickname ?? user.identity;

      // Lookup ward for this user
      const ward = await this.dbService.findWardByUserId(user.id);
      if (ward) {
        wardId = ward.id;
        this.logger.log(`Found ward for user: wardId=${wardId}`);

        // Try to get location from ward's current location
        // For now, use default Seoul coordinates
        // TODO: Fetch from wardCurrentLocation table if needed
      }

      // Create call record for proper transcript storage
      try {
        const call = await this.dbService.createCall({
          callerIdentity: 'agent-auto',
          calleeIdentity: identity,
          calleeUserId: user.id,
          roomName,
        });
        callId = call.id;
        this.logger.log(`Created call record: callId=${callId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to create call record: ${(error as Error).message}`,
        );
      }
    } else {
      // No user specified - create minimal bot session
      identity = `bot-${randomUUID()}`;
      name = identity;
    }

    this.logger.log(
      `createBotWithAgent room=${roomName} identity=${identity} userId=${userId ?? 'none'} wardId=${wardId ?? 'none'} callId=${callId ?? 'none'}`,
    );

    // Dispatch voice agent with full metadata
    try {
      await this.liveKitService.dispatchVoiceAgent(roomName, {
        userId,
        identity,
        name,
        type: 'bot',
        wardId,
        callId,
        latitude,
        longitude,
      });
    } catch (err) {
      this.logger.error(
        `Failed to dispatch voice agent: ${(err as Error).message}`,
      );
    }

    // Generate LiveKit token for the bot participant
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
      // Include context for debugging
      userId,
      wardId,
      callId,
      latitude,
      longitude,
    };
  }

  /**
   * Find user by ID (UUID) or identity string
   */
  private async findUser(userIdOrIdentity: string) {
    // Try UUID format first
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        userIdOrIdentity,
      );

    if (isUuid) {
      return this.dbService.findUserById(userIdOrIdentity);
    }
    return this.dbService.findUserByIdentity(userIdOrIdentity);
  }
}
