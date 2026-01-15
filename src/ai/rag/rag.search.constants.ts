/**
 * RAG Search Constants
 *
 * 검색 관련 상수를 중앙에서 관리합니다.
 * 환경 변수로 오버라이드 가능하며, 기본값은 여기서 정의됩니다.
 */

/**
 * 벡터 검색 유사도 임계값
 * - 이 값보다 낮은 유사도 결과는 필터링됨
 * - 0.4 → 0.3으로 완화하여 더 많은 후보 확보
 */
export const VECTOR_SIMILARITY_THRESHOLD = parseFloat(
  process.env.SIMILARITY_THRESHOLD || '0.3',
);

/**
 * 검색 결과 최대 개수
 * - AI에게 전달할 컨텍스트 수
 * - 3 → 5로 상향하여 핵심 키워드 누락 방지
 */
export const SEARCH_LIMIT = parseInt(process.env.RAG_SEARCH_LIMIT || '5', 10);

/**
 * RRF (Reciprocal Rank Fusion) K 파라미터
 * - 순위 차이를 완화하는 상수
 * - k가 클수록 순위 차이가 덜 중요해짐
 */
export const RRF_K = parseInt(process.env.RRF_K || '60', 10);

/**
 * FTS 정확 매칭 부스트 배수
 * - 핵심 키워드가 정확히 매칭될 때 점수 부스트
 */
export const FTS_EXACT_MATCH_BOOST = parseFloat(
  process.env.RAG_FTS_EXACT_MATCH_BOOST || '2.0',
);

/**
 * 검색 결과 확장 배수
 * - RRF 적용 전 더 많은 후보 수집
 */
export const SEARCH_EXPANSION_FACTOR = parseInt(
  process.env.RAG_SEARCH_EXPANSION_FACTOR || '2',
  10,
);

/**
 * FTS 검색 타임아웃 (ms)
 */
export const FTS_SEARCH_TIMEOUT_MS = parseInt(
  process.env.RAG_FTS_SEARCH_TIMEOUT_MS || '2000',
  10,
);

/**
 * 벡터 검색 타임아웃 (ms)
 */
export const VECTOR_SEARCH_TIMEOUT_MS = parseInt(
  process.env.RAG_VECTOR_SEARCH_TIMEOUT_MS || '2000',
  10,
);
