export type RedisConnectionInfo = {
  host: string;
  port: number;
  password?: string;
};

export function parseRedisUrl(url: string): RedisConnectionInfo {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || 6379,
    password: parsed.password || undefined,
  };
}
