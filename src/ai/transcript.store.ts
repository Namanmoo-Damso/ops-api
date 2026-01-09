import { Injectable, Logger } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

type TranscriptEntry = {
  speaker?: string;
  text?: string;
  timestamp?: string;
};

@Injectable()
export class TranscriptStore {
  private readonly logger = new Logger(TranscriptStore.name);
  private readonly redisUrl = process.env.REDIS_URL;
  private client: RedisClientType | null = null;
  private connecting: Promise<RedisClientType | null> | null = null;
  private warnedMissingUrl = false;

  private async getClient(): Promise<RedisClientType | null> {
    if (!this.redisUrl) {
      if (!this.warnedMissingUrl) {
        this.warnedMissingUrl = true;
        this.logger.warn('REDIS_URL not set - transcript lookup disabled');
      }
      return null;
    }

    if (this.client?.isOpen) {
      return this.client;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.client = createClient({ url: this.redisUrl });

    // Handle connection errors to prevent unhandled 'error' events
    this.client.on('error', (error) => {
      this.logger.warn(`Redis client error: ${error.message}`);
    });

    this.connecting = this.client
      .connect()
      .then(() => this.client)
      .catch(error => {
        this.logger.warn(`Redis connect failed: ${(error as Error).message}`);
        this.client = null;
        return null;
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  private formatEntry(entry: TranscriptEntry): string | null {
    if (!entry.text) return null;
    const speaker =
      entry.speaker === 'user'
        ? '어르신'
        : entry.speaker === 'agent'
          ? 'AI'
          : '참여자';
    return `${speaker}: ${entry.text}`;
  }

  async getTranscript(callId: string): Promise<string | null> {
    if (!callId) return null;
    const client = await this.getClient();
    if (!client) return null;

    const key = `call:${callId}:transcripts`;
    try {
      const entries = await client.lRange(key, 0, -1);
      if (!entries.length) return null;

      const lines: string[] = [];
      for (const raw of entries) {
        try {
          const parsed = JSON.parse(raw) as TranscriptEntry;
          const line = this.formatEntry(parsed);
          if (line) lines.push(line);
        } catch {
          // Ignore malformed transcript entries.
        }
      }

      return lines.length ? lines.join('\n') : null;
    } catch (error) {
      this.logger.warn(
        `Redis transcript fetch failed callId=${callId} error=${(error as Error).message}`,
      );
      return null;
    }
  }
}
