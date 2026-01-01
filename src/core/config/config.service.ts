import { Injectable } from '@nestjs/common';

export type PushEnv = 'prod' | 'sandbox';
export type PushEnvMode = 'prod' | 'sandbox' | 'both';

export type AppConfig = {
  port: number;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitTokenTtlSeconds: number;
  apiJwtSecret: string;
  apiJwtTtlSeconds: number;
  authRequired: boolean;
  corsOrigin: string;
  apnsEnvMode: PushEnvMode;
  apnsDefaultEnv: PushEnv;
};

const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
};

const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
};

let cachedConfig: AppConfig | null = null;

@Injectable()
export class ConfigService {
  getConfig(): AppConfig {
    if (cachedConfig) return cachedConfig;

    const apnsModeRaw = process.env.APNS_ENV ?? 'prod';
    const apnsMode: PushEnvMode =
      apnsModeRaw === 'both'
        ? 'both'
        : apnsModeRaw === 'sandbox'
          ? 'sandbox'
          : 'prod';

    cachedConfig = {
      port: parseNumber(process.env.PORT, 8080),
      livekitUrl: getEnv('LIVEKIT_URL'),
      livekitApiKey: getEnv('LIVEKIT_API_KEY'),
      livekitApiSecret: getEnv('LIVEKIT_API_SECRET'),
      livekitTokenTtlSeconds: parseNumber(process.env.LIVEKIT_TOKEN_TTL, 600),
      apiJwtSecret: getEnv('API_JWT_SECRET', 'change-me'),
      apiJwtTtlSeconds: parseNumber(process.env.API_JWT_TTL, 60 * 60 * 24),
      authRequired: parseBoolean(process.env.API_AUTH_REQUIRED, false),
      corsOrigin: getEnv('CORS_ORIGIN', '*'),
      apnsEnvMode: apnsMode,
      apnsDefaultEnv: apnsMode === 'sandbox' ? 'sandbox' : 'prod',
    };
    return cachedConfig;
  }

  get livekitUrl(): string {
    return this.getConfig().livekitUrl;
  }

  get livekitApiKey(): string {
    return this.getConfig().livekitApiKey;
  }

  get livekitApiSecret(): string {
    return this.getConfig().livekitApiSecret;
  }

  get authRequired(): boolean {
    return this.getConfig().authRequired;
  }

  get apnsDefaultEnv(): PushEnv {
    return this.getConfig().apnsDefaultEnv;
  }

  normalizeEnv(env?: string): PushEnv {
    return env === 'sandbox' ? 'sandbox' : 'prod';
  }
}
