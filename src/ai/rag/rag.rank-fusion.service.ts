import { Injectable, Logger } from '@nestjs/common';
import { SearchResult } from './rag.types';

/**
 * Rank Fusion Service
 *
 * RRF(Reciprocal Rank Fusion) 알고리즘을 사용한 검색 결과 순위 합산:
 * - 벡터 검색과 FTS 결과를 결합
 * - RRF 공식: score = Σ 1/(k + rank)
 * - Zero-Result 처리: 벡터 검색 결과가 없을 때 FTS 추천 제공
 * - 키워드 매칭 부스팅: 핵심 키워드 포함 결과 우선 배치
 */
@Injectable()
export class RagRankFusionService {
  private readonly logger = new Logger(RagRankFusionService.name);

  // RRF 파라미터 k: 순위 차이를 완화하는 상수
  // k가 클수록 순위 차이가 덜 중요해짐
  private readonly RRF_K = parseInt(process.env.RRF_K || '60', 10);

  // 키워드 매칭 부스트 배수
  private readonly KEYWORD_MATCH_BOOST = parseFloat(
    process.env.RAG_KEYWORD_MATCH_BOOST || '1.5',
  );

  private readonly DEBUG_LOGS = process.env.RAG_DEBUG_LOGS === 'true';

  /**
   * RRF 알고리즘으로 벡터 검색과 FTS 결과 결합
   *
   * @param vectorResults 벡터 검색 결과
   * @param ftsResults Full-Text Search 결과
   * @param limit 최종 반환할 결과 수
   * @param queryKeywords 쿼리 핵심 키워드 (선택적, 부스팅용)
   * @returns RRF 점수로 정렬된 결과
   */
  fuseResults(
    vectorResults: SearchResult[],
    ftsResults: SearchResult[],
    limit: number,
    queryKeywords?: string[],
  ): SearchResult[] {
    this.debug(
      `Fusing results: vector=${vectorResults.length}, fts=${ftsResults.length}, keywords=${queryKeywords?.join(', ') || 'none'}`,
    );

    // Zero-Result 처리
    if (vectorResults.length === 0 && ftsResults.length === 0) {
      this.logger.warn('No results from both vector and FTS search');
      return [];
    }

    // Vector 결과가 없을 때: FTS 결과 중 키워드 매칭 우선
    if (vectorResults.length === 0) {
      this.logger.log(
        `Zero vector results - returning top ${limit} FTS with keyword prioritization`,
      );
      return this.prioritizeByKeywords(ftsResults, limit, queryKeywords);
    }

    if (ftsResults.length === 0) {
      this.debug('Zero FTS results - returning vector results only');
      return vectorResults.slice(0, limit).map(result => ({
        ...result,
        metadata: {
          ...result.metadata,
          hasKeywordMatch: false,
          isRecommendation: false,
        },
      }));
    }

    // Step 1: 각 결과에 순위 부여 (1-based)
    const vectorRanks = new Map<string, number>(
      vectorResults.map((r, i) => [this.getResultId(r), i + 1]),
    );
    const ftsRanks = new Map<string, number>(
      ftsResults.map((r, i) => [this.getResultId(r), i + 1]),
    );

    // Step 2: 모든 고유 결과 ID 수집
    const allIds = new Set([...vectorRanks.keys(), ...ftsRanks.keys()]);

    this.debug(`Total unique results: ${allIds.size}`);

    // Step 3: RRF 점수 계산
    const scoredResults: Array<{
      id: string;
      result: SearchResult;
      rrfScore: number;
      vectorRank?: number;
      ftsRank?: number;
      hasKeywordMatch: boolean;
    }> = [];

    // 결과를 ID로 빠르게 조회하기 위한 Map
    const resultMap = new Map<string, SearchResult>();
    vectorResults.forEach(r => resultMap.set(this.getResultId(r), r));
    ftsResults.forEach(r => resultMap.set(this.getResultId(r), r));

    for (const id of allIds) {
      const vectorRank = vectorRanks.get(id);
      const ftsRank = ftsRanks.get(id);

      // RRF 공식: score = 1/(k + vectorRank) + 1/(k + ftsRank)
      let rrfScore =
        (vectorRank ? 1 / (this.RRF_K + vectorRank) : 0) +
        (ftsRank ? 1 / (this.RRF_K + ftsRank) : 0);

      const result = resultMap.get(id);
      if (!result) continue;

      // 키워드 매칭 부스팅
      const hasKeywordMatch = this.hasKeywordMatch(result, queryKeywords);
      if (hasKeywordMatch) {
        rrfScore *= this.KEYWORD_MATCH_BOOST;
        this.debug(`Boosted score for result with keyword match: ${id}`);
      }

      scoredResults.push({
        id,
        result,
        rrfScore,
        vectorRank,
        ftsRank,
        hasKeywordMatch,
      });
    }

    // Step 4: RRF 점수로 정렬
    scoredResults.sort((a, b) => b.rrfScore - a.rrfScore);

    // Step 5: 상위 N개 선택
    const topResults = scoredResults.slice(0, limit);

    // Step 6: 키워드 매칭 결과가 limit에 밀려났는지 확인
    const missedKeywordMatches = scoredResults
      .slice(limit)
      .filter(r => r.hasKeywordMatch);

    if (missedKeywordMatches.length > 0 && topResults.length === limit) {
      // limit 밖에 키워드 매칭 결과가 있으면, 가장 낮은 점수 결과와 교체
      let indexToReplace = -1;
      for (let i = topResults.length - 1; i >= 0; i--) {
        if (!topResults[i].hasKeywordMatch) {
          indexToReplace = i;
          break;
        }
      }

      if (indexToReplace !== -1) {
        this.logger.log(
          `Swapping non-keyword result with keyword-matched result`,
        );
        topResults[indexToReplace] = missedKeywordMatches[0];
      }
    }

    // Step 7: 부스팅 및 교체 반영 후 재정렬
    topResults.sort((a, b) => {
      if (a.hasKeywordMatch !== b.hasKeywordMatch) {
        return a.hasKeywordMatch ? -1 : 1;
      }
      return b.rrfScore - a.rrfScore;
    });

    if (this.DEBUG_LOGS && topResults.length > 0) {
      this.logger.debug(
        `Top result: rrfScore=${topResults[0].rrfScore.toFixed(4)}, ` +
          `vectorRank=${topResults[0].vectorRank || 'N/A'}, ` +
          `ftsRank=${topResults[0].ftsRank || 'N/A'}, ` +
          `keywordMatch=${topResults[0].hasKeywordMatch}`,
      );
    }

    // Step 8: SearchResult 반환 (RRF 점수를 similarity에 저장)
    return topResults.map(scored => ({
      ...scored.result,
      similarity: scored.rrfScore, // RRF 점수를 similarity 필드에 저장
      metadata: {
        ...scored.result.metadata,
        rrfScore: scored.rrfScore,
        vectorRank: scored.vectorRank,
        ftsRank: scored.ftsRank,
        hasKeywordMatch: scored.hasKeywordMatch,
        isRecommendation: false,
      },
    }));
  }

  /**
   * 키워드 기준 우선순위 정렬
   * Vector 결과가 없을 때 FTS 결과 중 핵심 키워드 포함 결과를 우선 배치
   */
  private prioritizeByKeywords(
    results: SearchResult[],
    limit: number,
    queryKeywords?: string[],
  ): SearchResult[] {
    if (!queryKeywords || queryKeywords.length === 0 || results.length === 0) {
      return results.slice(0, limit).map(r => ({
        ...r,
        metadata: {
          ...r.metadata,
          isRecommendation: true,
          hasKeywordMatch: false,
        },
      }));
    }

    // 키워드 매칭 여부로 분류
    const withKeyword: SearchResult[] = [];
    const withoutKeyword: SearchResult[] = [];

    for (const result of results) {
      if (this.hasKeywordMatch(result, queryKeywords)) {
        withKeyword.push(result);
      } else {
        withoutKeyword.push(result);
      }
    }

    this.logger.log(
      `Keyword prioritization: ${withKeyword.length} matched, ${withoutKeyword.length} unmatched`,
    );

    // 키워드 매칭 결과 우선 + 나머지
    const prioritized = [...withKeyword, ...withoutKeyword].slice(0, limit);

    return prioritized.map((r, idx) => ({
      ...r,
      metadata: {
        ...r.metadata,
        isRecommendation: true,
        hasKeywordMatch: idx < withKeyword.length,
      },
    }));
  }

  /**
   * 결과에 핵심 키워드가 포함되어 있는지 확인
   */
  private hasKeywordMatch(
    result: SearchResult,
    queryKeywords?: string[],
  ): boolean {
    if (!queryKeywords || queryKeywords.length === 0) {
      return false;
    }

    // 검색 대상: text, childText, chunk_header
    const searchableText = [
      result.text || '',
      result.childText || '',
      result.metadata?.chunk_header || '',
    ]
      .join(' ')
      .toLowerCase();

    return queryKeywords.some(keyword =>
      searchableText.includes(keyword.toLowerCase()),
    );
  }

  /**
   * Zero-Result 처리: 벡터 검색 결과가 없을 때 FTS 추천 제공
   *
   * @param ftsResults FTS 검색 결과
   * @param limit 추천할 결과 수
   * @returns 추천 결과
   */
  handleZeroResults(ftsResults: SearchResult[], limit: number): SearchResult[] {
    if (ftsResults.length === 0) {
      return [];
    }

    this.logger.log(
      `Providing ${Math.min(ftsResults.length, limit)} FTS recommendations for zero-result query`,
    );

    return ftsResults.slice(0, limit).map(r => ({
      ...r,
      metadata: {
        ...r.metadata,
        isRecommendation: true, // 추천 결과임을 표시
        hasKeywordMatch: false,
      },
    }));
  }

  /**
   * 결과의 고유 ID 생성 (parent_id 기준)
   * Parent-Child 구조에서 중복 제거를 위해 parent_id 사용
   */
  private getResultId(result: SearchResult): string {
    return result.parentId || result.callId || result.text.substring(0, 50);
  }

  private debug(message: string): void {
    if (this.DEBUG_LOGS) {
      this.logger.debug(message);
    }
  }
}
