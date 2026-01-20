import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { KoreanQueryProcessor } from './rag.korean-query.processor';

/**
 * RagNormalizer
 *
 * 캐시 키 생성을 위한 전처리 전용 유틸리티:
 * - 조사 제거 + 특수문자 제거 + 토큰 길이 필터링
 * - 원문 임베딩 호출은 유지하고, 캐시 키만 정규화
 */
@Injectable()
export class RagNormalizer {
  private readonly MIN_TOKEN_LENGTH = 2;

  constructor(
    private readonly koreanQueryProcessor: KoreanQueryProcessor,
  ) {}

  /**
   * 캐시 키 생성을 위한 정규화
   * @returns normalized 문자열과 해시 (없으면 null)
   */
  normalizeForCache(
    text: string,
  ): { normalized: string; hash: string } | null {
    if (!text || text.trim().length === 0) {
      return null;
    }

    const tokens = text
      .toLowerCase()
      .split(/\s+/)
      .map(token => this.koreanQueryProcessor.removeJosa(token))
      .map(token => this.koreanQueryProcessor.sanitizeToken(token))
      .filter(token => token.length >= this.MIN_TOKEN_LENGTH);

    // 토큰이 모두 비면 원문을 간단히 트림/소문자 처리 후 해싱
    const normalized =
      tokens.length > 0 ? tokens.join(' ') : text.toLowerCase().trim();

    if (!normalized) {
      return null;
    }

    return {
      normalized,
      hash: this.hash(normalized),
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
