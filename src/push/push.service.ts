import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import apn from 'apn';

type PushType = 'alert' | 'voip';
type PushEnvMode = 'prod' | 'sandbox' | 'both';
type PushEnv = 'prod' | 'sandbox';

type PushResult = {
  sent: number;
  failed: number;
  invalidTokens: string[];
};

const chunk = <T>(items: T[], size: number) => {
  const buckets: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    buckets.push(items.slice(i, i + size));
  }
  return buckets;
};

@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly keyPath?: string;
  private readonly keyId?: string;
  private readonly teamId?: string;
  private readonly bundleId?: string;
  private readonly voipTopic?: string;
  private readonly envMode: PushEnvMode;
  private prodProvider?: any;
  private sandboxProvider?: any;

  constructor() {
    this.keyPath = process.env.APNS_KEY_PATH;
    this.keyId = process.env.APNS_KEY_ID;
    this.teamId = process.env.APNS_TEAM_ID;
    this.bundleId = process.env.APNS_BUNDLE_ID;
    this.voipTopic = process.env.APNS_VOIP_TOPIC;
    const mode = process.env.APNS_ENV ?? 'prod';
    this.envMode =
      mode === 'both' ? 'both' : mode === 'sandbox' ? 'sandbox' : 'prod';
    this.logger.log(
      `APNs config envMode=${this.envMode} bundleId=${this.bundleId ?? 'unset'} voipTopic=${this.voipTopic ?? 'default'} keyId=${this.keyId ?? 'unset'} teamId=${this.teamId ?? 'unset'} keyPath=${this.keyPath ?? 'unset'}`,
    );
  }

  onModuleDestroy() {
    this.prodProvider?.shutdown();
    this.sandboxProvider?.shutdown();
  }

  private ensureReady() {
    if (!this.keyPath || !this.keyId || !this.teamId || !this.bundleId) {
      throw new Error('APNs not configured');
    }
  }

  private getProvider(env: PushEnv) {
    this.ensureReady();
    if (env === 'prod') {
      if (!this.prodProvider) {
        this.prodProvider = new (apn as any).Provider({
          token: { key: this.keyPath, keyId: this.keyId, teamId: this.teamId },
          production: true,
        });
      }
      return this.prodProvider;
    }

    if (!this.sandboxProvider) {
      this.sandboxProvider = new (apn as any).Provider({
        token: { key: this.keyPath, keyId: this.keyId, teamId: this.teamId },
        production: false,
      });
    }
    return this.sandboxProvider;
  }

  private resolveTopic(type: PushType) {
    if (type === 'voip') {
      return this.voipTopic ?? `${this.bundleId}.voip`;
    }
    return this.bundleId!;
  }

  private resolveEnv(targetEnv?: PushEnv): PushEnv | null {
    if (this.envMode === 'both') {
      return targetEnv ?? 'prod';
    }
    if (this.envMode === 'prod' && targetEnv === 'sandbox') return null;
    if (this.envMode === 'sandbox' && targetEnv === 'prod') return null;
    return (targetEnv ?? this.envMode) as PushEnv;
  }

  async sendPush(params: {
    tokens: { token: string; env: string }[];
    type: PushType;
    title?: string;
    body?: string;
    payload?: Record<string, unknown>;
    category?: string;
    sound?: string;
    interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical';
  }): Promise<PushResult> {
    this.ensureReady();
    const invalidTokens: string[] = [];
    let sent = 0;
    let failed = 0;
    const topic = this.resolveTopic(params.type);
    this.logger.log(
      `sendPush type=${params.type} topic=${topic} tokens=${params.tokens.length} category=${params.category ?? 'none'}`,
    );

    for (const batch of chunk(params.tokens, 100)) {
      const grouped: Record<PushEnv, string[]> = { prod: [], sandbox: [] };
      for (const item of batch) {
        const resolved = this.resolveEnv(item.env as PushEnv);
        if (!resolved) continue;
        grouped[resolved].push(item.token);
      }

      for (const env of Object.keys(grouped) as PushEnv[]) {
        if (grouped[env].length === 0) continue;
        this.logger.log(`sendPush env=${env} batch=${grouped[env].length}`);
        const provider = this.getProvider(env);
        const notification = new (apn as any).Notification();
        notification.topic = topic;
        notification.pushType = params.type;
        notification.priority = 10;
        notification.expiry = Math.floor(Date.now() / 1000) + 60 * 60;

        if (params.type === 'alert') {
          if (params.title || params.body) {
            notification.alert = {
              title: params.title ?? '',
              body: params.body ?? '',
            };
          }
          notification.sound = params.sound ?? 'default';
          if (params.category) {
            notification.category = params.category;
          }
          if (params.interruptionLevel) {
            notification.interruptionLevel = params.interruptionLevel;
          }
          // content-available 추가하여 백그라운드에서도 앱이 깨어날 수 있도록
          notification.contentAvailable = true;
        } else {
          notification.contentAvailable = true;
        }

        notification.payload = params.payload ?? {};

        const response = await provider.send(notification, grouped[env]);
        sent += response.sent.length;
        failed += response.failed.length;
        this.logger.log(
          `sendPush env=${env} sent=${response.sent.length} failed=${response.failed.length}`,
        );

        for (const failure of response.failed) {
          const responseInfo = failure.response as
            | { reason?: string; status?: number }
            | undefined;
          const reason = responseInfo?.reason || failure.error?.message;
          const status =
            (failure as { status?: number }).status ??
            responseInfo?.status ??
            undefined;
          this.logger.warn(
            `sendPush failure env=${env} reason=${reason ?? 'unknown'} status=${status ?? 'unknown'} token=${this.summarizeToken(failure.device)}`,
          );
          if (
            reason === 'BadDeviceToken' ||
            reason === 'Unregistered' ||
            reason === 'DeviceTokenNotForTopic'
          ) {
            invalidTokens.push(failure.device);
          }
        }
      }
    }

    this.logger.log(
      `sendPush result sent=${sent} failed=${failed} invalid=${invalidTokens.length}`,
    );
    return { sent, failed, invalidTokens };
  }

  private summarizeToken(token?: string) {
    if (!token) return 'none';
    const suffix = token.slice(-6);
    return `len=${token.length}..${suffix}`;
  }
}
