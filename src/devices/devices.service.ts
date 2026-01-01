import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../database';
import { ConfigService } from '../core/config';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly configService: ConfigService,
  ) {}

  async registerDevice(params: {
    identity: string;
    displayName?: string;
    platform: string;
    env?: string;
    apnsToken?: string;
    voipToken?: string;
    supportsCallKit?: boolean;
  }) {
    if (!params.apnsToken && !params.voipToken) {
      throw new Error('apnsToken or voipToken is required');
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
