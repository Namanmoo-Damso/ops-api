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

/**
 * Validate embedding vector (non-empty, finite numbers).
 */
export function isValidEmbedding(
  embedding: number[] | null | undefined,
): embedding is number[] {
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    return false;
  }

  return embedding.every(value => Number.isFinite(value));
}

/**
 * Child chunk configuration
 */
export interface ChildChunk {
  text: string;
  offsetStart: number;
  offsetEnd: number;
}

/**
 * Split parent text into child chunks for searchable indexing
 *
 * Strategy: Split by sentences or fixed-size chunks
 * - Prefer sentence boundaries (., !, ?, \n\n)
 * - Fall back to character-based split if sentences too long
 *
 * @param parentText Full parent text to split
 * @param childSize Target size for each child chunk (default: 200 chars)
 * @param overlap Overlap between chunks (default: 50 chars)
 * @returns Array of child chunks with offset positions
 */
export function splitIntoChildChunks(
  parentText: string,
  childSize: number = 200,
  overlap: number = 50,
): ChildChunk[] {
  if (!parentText || parentText.length === 0) {
    return [];
  }

  const chunks: ChildChunk[] = [];
  let currentStart = 0;

  while (currentStart < parentText.length) {
    let currentEnd = Math.min(currentStart + childSize, parentText.length);

    // Try to find a sentence boundary near the target end
    if (currentEnd < parentText.length) {
      // Look for sentence endings within the last 20% of the chunk
      const searchStart = Math.max(
        currentStart,
        currentEnd - Math.floor(childSize * 0.2),
      );
      const searchText = parentText.substring(searchStart, currentEnd + 20);

      // Korean and English sentence endings
      const sentenceEndings = [
        '\n\n',
        '.\n',
        '!\n',
        '?\n',
        '. ',
        '! ',
        '? ',
        '。 ',
        '！ ',
        '？ ',
        '。\n',
        '！\n',
        '？\n',
        '다. ',
        '다.\n',
        '요. ',
        '요.\n',
        '죠. ',
        '죠.\n',
        '니다. ',
        '니다.\n',
        '습니다. ',
        '습니다.\n',
        '네요. ',
        '네요.\n',
        '군요. ',
        '군요.\n',
      ];
      let bestBoundary = -1;

      for (const ending of sentenceEndings) {
        const idx = searchText.lastIndexOf(ending);
        if (idx !== -1) {
          const candidate = searchStart + idx + ending.length;
          if (candidate > bestBoundary) {
            bestBoundary = candidate;
          }
        }
      }

      if (bestBoundary > currentStart) {
        currentEnd = bestBoundary;
      }
    }

    // Add chunk
    const chunkText = parentText.substring(currentStart, currentEnd).trim();
    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        offsetStart: currentStart,
        offsetEnd: currentEnd,
      });
    }

    // Move to next chunk with overlap
    const nextStart = currentEnd - overlap;

    // Safety check: ensure we're making progress
    if (nextStart <= currentStart) {
      // If we're not making progress, move forward by at least 1 character
      currentStart = currentEnd;
    } else {
      currentStart = nextStart;
    }

    // Break if we're near the end
    if (currentStart >= parentText.length - 10) {
      break; // Avoid tiny trailing chunks
    }
  }

  return chunks;
}

/**
 * Get window context around a child chunk from parent text
 *
 * Extracts surrounding context from parent text based on child position
 * Useful for providing broader context when a child chunk is matched
 *
 * @param parentText Full parent text
 * @param offsetStart Child chunk start position
 * @param offsetEnd Child chunk end position
 * @param windowChars Number of characters to include before/after (default: 150)
 * @returns Context snippet with window around child
 */
export function getWindowContext(
  parentText: string,
  offsetStart: number,
  offsetEnd: number,
  windowChars: number = 150,
): string {
  if (!parentText || offsetStart < 0 || offsetEnd > parentText.length) {
    return '';
  }

  // Calculate window boundaries
  const windowStart = Math.max(0, offsetStart - windowChars);
  const windowEnd = Math.min(parentText.length, offsetEnd + windowChars);

  // Extract window text
  let snippet = parentText.substring(windowStart, windowEnd);

  // Add ellipsis if truncated
  if (windowStart > 0) {
    snippet = '...' + snippet;
  }
  if (windowEnd < parentText.length) {
    snippet = snippet + '...';
  }

  return snippet.trim();
}
