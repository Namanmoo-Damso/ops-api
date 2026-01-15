/**
 * Korean Query Processor
 *
 * 한글 쿼리 전처리를 담당:
 * - 조사 제거 (은/는/이/가/을/를 등)
 * - 핵심어 추출 및 가중치 부여
 * - FTS 쿼리 생성: 핵심어:* & (확장어1:* | 확장어2:*)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  FTS_MAX_TOKENS,
  FTS_MAX_TOKEN_LENGTH,
  FTS_UNSAFE_CHARS,
} from './rag.search.constants';

/**
 * 키워드 분류 결과
 */
export interface KeywordClassification {
  /** 핵심 키워드 (가장 중요한 검색어) */
  primary: string[];
  /** 확장 키워드 (관련 검색어) */
  secondary: string[];
  /** 모든 키워드 (조사 제거된) */
  all: string[];
}

@Injectable()
export class KoreanQueryProcessor {
  private readonly logger = new Logger(KoreanQueryProcessor.name);

  /**
   * 한글 조사 패턴
   * - 주격/목적격/부사격 조사 등
   */
  private readonly JOSA_PATTERNS = [
    // 주격 조사
    /[은는이가]$/,
    // 목적격 조사
    /[을를]$/,
    // 부사격 조사
    /에서?$/,
    /으?로$/,
    /[와과]$/,
    /[도만]$/,
    // 관형격 조사
    /의$/,
    // 접속 조사
    /랑$/,
    /하고$/,
    // 보조사
    /까지$/,
    /부터$/,
    /마다$/,
    /처럼$/,
    /같이$/,
  ];

  /**
   * 불용어 목록 (검색에서 제외할 단어)
   */
  private readonly STOPWORDS = new Set([
    '뭐',
    '뭘',
    '어떻게',
    '왜',
    '언제',
    '어디',
    '누가',
    '무엇',
    '했',
    '했는지',
    '했어',
    '했지',
    '했나',
    '했더라',
    '좀',
    '그',
    '저',
    '이',
    '것',
    '거',
    '때',
  ]);

  /**
   * 조사 제거
   */
  removeJosa(word: string): string {
    if (!word || word.length < 2) return word;

    let result = word;

    for (const pattern of this.JOSA_PATTERNS) {
      const match = result.match(pattern);
      if (match) {
        // 조사 제거 후 최소 1글자 이상이어야 함
        const stripped = result.replace(pattern, '');
        if (stripped.length >= 1) {
          result = stripped;
          break; // 하나의 조사만 제거
        }
      }
    }

    return result;
  }

  private sanitizeToken(token: string): string {
    if (!token) return '';
    const sanitized = token.replace(FTS_UNSAFE_CHARS, '').trim();
    if (!sanitized) return '';
    return sanitized.slice(0, FTS_MAX_TOKEN_LENGTH);
  }

  /**
   * 쿼리에서 키워드 추출 및 분류
   *
   * 핵심어 결정 기준:
   * 1. 가장 긴 단어 (구체적인 명사일 가능성 높음)
   * 2. 불용어가 아닌 단어
   */
  extractKeywords(query: string): KeywordClassification {
    if (!query || query.trim().length === 0) {
      return { primary: [], secondary: [], all: [] };
    }

    // Step 1: 공백으로 분리
    const tokens = query.trim().split(/\s+/);

    // Step 2: 조사 제거 및 불용어 필터링
    const cleanedTokens = tokens
      .map(token => this.removeJosa(token))
      .map(token => this.sanitizeToken(token))
      .filter(token => token.length >= 2)
      .filter(token => !this.STOPWORDS.has(token));

    if (cleanedTokens.length === 0) {
      return { primary: [], secondary: [], all: [] };
    }

    // Step 3: 중복 제거
    const uniqueTokens = [...new Set(cleanedTokens)];

    // Step 4: 길이순 정렬 (긴 단어가 더 구체적)
    const sortedByLength = [...uniqueTokens].sort(
      (a, b) => b.length - a.length,
    );

    // Step 5: 최대 토큰 수 제한
    const limitedTokens = sortedByLength.slice(0, FTS_MAX_TOKENS);

    // Step 6: 핵심어 선정 (가장 긴 단어 최대 2개)
    const primary = limitedTokens.slice(0, 2);

    // Step 7: 나머지는 확장 키워드
    const secondary = limitedTokens.slice(2);

    this.logger.debug(
      `Extracted keywords: primary=[${primary.join(', ')}], secondary=[${secondary.join(', ')}]`,
    );

    return {
      primary,
      secondary,
      all: limitedTokens,
    };
  }

  /**
   * FTS 쿼리 생성
   *
   * 형식: 핵심어:* & (확장어1:* | 확장어2:*)
   * - 핵심어는 AND로 결합 (반드시 포함)
   * - 확장어는 OR로 결합 (선택적 포함)
   */
  buildFtsQuery(keywords: KeywordClassification): string {
    if (keywords.all.length === 0) {
      return '';
    }

    // 모든 키워드에 :* 추가 (prefix 검색)
    const primaryTerms = keywords.primary.filter(Boolean).map(k => `${k}:*`);
    const secondaryTerms = keywords.secondary
      .filter(Boolean)
      .map(k => `${k}:*`);

    // 핵심어만 있는 경우
    if (secondaryTerms.length === 0 && primaryTerms.length > 0) {
      // 핵심어들을 OR로 연결 (하나라도 포함되면 매칭)
      return primaryTerms.join(' | ');
    }

    if (primaryTerms.length === 0 && secondaryTerms.length === 0) {
      return '';
    }

    if (primaryTerms.length === 0) {
      return secondaryTerms.join(' | ');
    }

    // 핵심어 + 확장어가 있는 경우
    // 핵심어 중 하나 필수 + 확장어는 선택
    const primaryPart =
      primaryTerms.length > 1
        ? `(${primaryTerms.join(' | ')})`
        : primaryTerms[0];
    const secondaryPart = `(${secondaryTerms.join(' | ')})`;

    // 핵심어 OR 확장어 (더 많은 결과 확보)
    return `${primaryPart} | ${secondaryPart}`;
  }

  /**
   * 결과에서 핵심 키워드 포함 여부 확인
   */
  containsPrimaryKeyword(
    text: string,
    keywords: KeywordClassification,
  ): boolean {
    if (!text || keywords.primary.length === 0) {
      return false;
    }

    const lowerText = text.toLowerCase();
    return keywords.primary.some(keyword =>
      lowerText.includes(keyword.toLowerCase()),
    );
  }
}
