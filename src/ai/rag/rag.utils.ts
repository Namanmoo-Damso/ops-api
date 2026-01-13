/**
 * Utility functions for RAG system
 */

const KST_OFFSET_HOURS = 9; // UTC+9 for Korea Standard Time

/**
 * Convert UTC Date to KST (Korea Standard Time, UTC+9)
 */
export function toKST(utcDate: Date): Date {
  const kstDate = new Date(utcDate);
  kstDate.setHours(kstDate.getHours() + KST_OFFSET_HOURS);
  return kstDate;
}

/**
 * Format KST date as "YYYY-MM-DD HH:mm KST"
 */
export function formatKST(kstDate: Date): string {
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  const hours = String(kstDate.getHours()).padStart(2, '0');
  const minutes = String(kstDate.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} KST`;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
