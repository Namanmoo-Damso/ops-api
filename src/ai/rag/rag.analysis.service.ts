import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RagNormalizer } from './rag.normalizer';
import { RagCacheService } from './rag.cache.service';
import { RagEmbeddingService } from './rag.embedding.service';
import { RagConfig } from './rag.config';
import { isValidEmbedding } from './rag.utils';

/**
 * RagAnalysisService
 *
 * 역할: 최근 대화 로그를 기반으로 자주 등장하는 문장을 정규화/집계하고,
 * 글로벌 캐시 워밍업을 수행합니다.
 *
 * SRP 관점:
 * - DB 집계 + 정규화 + 워밍업 오케스트레이션만 담당
 * - 임베딩 생성은 RagEmbeddingService, 캐시 적재는 RagCacheService에 위임
 */
@Injectable()
export class RagAnalysisService implements OnModuleInit {
  private readonly logger = new Logger(RagAnalysisService.name);
  private readonly LOOKBACK_DAYS = 7;
  private readonly WARMUP_LIMIT = 20;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly normalizer: RagNormalizer,
    private readonly cacheService: RagCacheService,
    private readonly embeddingService: RagEmbeddingService,
    private readonly config: RagConfig,
  ) {}

  async onModuleInit() {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
      return;
    }

    this.logger.log('Dev warm-up started on module init');
    this.warmupGlobalCache().catch(error => {
      this.logger.warn(
        `Dev warm-up skipped/failed: ${(error as Error).message}`,
      );
    });
  }

  /**
   * 매일 새벽 2시 (KST) 글로벌 캐시 워밍업
   */
  @Cron('0 0 2 * * *', { timeZone: 'Asia/Seoul' })
  async scheduledWarmup(): Promise<void> {
    this.logger.log('Scheduled warm-up started (02:00 KST)');
    await this.warmupGlobalCache();
  }

  /**
   * 최근 LOOKBACK_DAYS 동안의 자주 등장하는 문장을 정규화 기준으로 집계
   */
  async getTopNormalizedPhrases(): Promise<string[]> {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - this.LOOKBACK_DAYS);

    const rawRows = await this.prismaService.$queryRaw<Array<{ text: string }>>(
      Prisma.sql`
        SELECT parent_text AS text
        FROM conversation_vectors_parent
        WHERE parent_text IS NOT NULL
          AND COALESCE(
            (metadata->>'callDate')::timestamp,
            (metadata->>'callStartAt')::timestamp,
            created_at
          ) >= ${weekAgo}
      `,
    );

    const freq = new Map<string, number>();

    for (const row of rawRows) {
      const phrases = this.extractPhrases(row.text);
      for (const phrase of phrases) {
        const normalized = this.normalizer.normalizeForCache(phrase);
        if (!normalized || normalized.normalized.length < 2) {
          continue;
        }
        const count = freq.get(normalized.normalized) ?? 0;
        freq.set(normalized.normalized, count + 1);
      }
    }

    const sorted = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.WARMUP_LIMIT)
      .map(([normalized]) => normalized);

    this.logger.log(
      `Top phrases (normalized) gathered: count=${sorted.length}, window=${this.LOOKBACK_DAYS}d`,
    );

    return sorted;
  }

  /**
   * 글로벌 캐시 워밍업:
   * - 상위 문장을 임베딩 후 Global cache에 적재
   */
  async warmupGlobalCache(): Promise<void> {
    try {
      const phrases = await this.getTopNormalizedPhrases();
      if (phrases.length === 0) {
        this.logger.log('No phrases found for warm-up');
        return;
      }

      const model = this.config.embeddingModel;

      for (const phrase of phrases) {
        const normalized = this.normalizer.normalizeForCache(phrase);
        if (!normalized) continue;

        const cached = await this.cacheService.getGlobalCachedEmbedding(
          normalized.hash,
          model,
        );
        if (isValidEmbedding(cached)) {
          this.logger.debug(
            `Skip warm-up (cache hit) phrase="${phrase.substring(0, 30)}..."`,
          );
          continue;
        }

        try {
          const embedding = await this.embeddingService.generateEmbedding(
            normalized.normalized,
          );
          await this.cacheService.setGlobalCachedEmbedding(
            normalized.hash,
            model,
            embedding,
            normalized.normalized,
          );
          this.logger.log(
            `Warmed embedding (global cache) phrase="${phrase.substring(0, 30)}..."`,
          );
        } catch (error) {
          this.logger.warn(
            `Warm-up embedding failed phrase="${phrase.substring(
              0,
              30,
            )}..." reason=${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Warm-up pipeline failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private extractPhrases(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const phrases: string[] = [];
    const lines = text.split(/\n+/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Strip "[speaker]:" prefix to focus on the utterance
      const withoutSpeaker = trimmed.replace(/^\[[^\]]+\]:\s*/, '');
      const fragments = withoutSpeaker.split(/[.!?]+/);

      for (const fragment of fragments) {
        const candidate = fragment.trim();
        if (candidate.length > 0) {
          phrases.push(candidate);
        }
      }
    }

    return phrases;
  }
}
