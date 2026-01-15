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

const MIN_TOKEN_LENGTH = 2;
const MIN_STRIPPED_LENGTH = 1;
const MAX_PRIMARY_TERMS = 2;

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
  private readonly JOSA_PATTERN =
    /(에게서|한테서|으로부터|로부터|에서|에게|한테|께서|께|으로|로|에|까지|부터|마다|처럼|같이|하고|랑|와|과|은|는|이|가|을|를|도|만|의)$/;

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
    '누구',
    '무엇',
    '무슨',
    '어떤',
    '어느',
    '얼마',
    '얼마나',
    '몇',
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
    '그리고',
    '또는',
    '또한',
    '하지만',
    '그러나',
    '그래서',
    '그러면',
    '그러니까',
    '그래도',
    '혹은',
    '에서',
    '에게',
    '에게서',
    '한테',
    '한테서',
    '께',
    '께서',
    '으로',
    '로',
    '로부터',
    '으로부터',
    '까지',
    '부터',
    '마다',
    '처럼',
    '같이',
    '보다',
    '밖에',
  ]);

  /**
   * 조사 제거
   */
  removeJosa(word: string): string {
    if (!word || word.length < MIN_TOKEN_LENGTH) return word;

    const stripped = word.replace(this.JOSA_PATTERN, '');
    if (stripped.length >= MIN_STRIPPED_LENGTH && stripped !== word) {
      return stripped;
    }
    return word;
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
      .filter(token => token.length >= MIN_TOKEN_LENGTH)
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
    const primary = limitedTokens.slice(0, MAX_PRIMARY_TERMS);

    // Step 7: 나머지는 확장 키워드
    const secondary = limitedTokens.slice(MAX_PRIMARY_TERMS);

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
