export type TranscriptLine = {
  speaker: string;
  text: string;
  timestamp?: string;
};

export type Chunk = { content: string; metadata: Record<string, any> };

export type ChunkOptions = {
  chunkSize: number;
};

/**
 * Split transcripts into contextual chunks with metadata.
 * Keeps most of the conversation together unless the configured chunk size is exceeded.
 */
export function buildContextualChunks(
  transcripts: TranscriptLine[],
  pastContextText: string,
  { chunkSize }: ChunkOptions,
): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer: Array<{ speaker: string; text: string }> = [];
  let sequence = 1;

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const rawSegment = buffer.map(t => `[${t.speaker}]: ${t.text}`).join('\n');
    const keywords = extractKeywords(rawSegment);
    const relatedToPast = checkRelatedToPast(keywords, pastContextText);
    const metadata = {
      sequence,
      topic: inferTopic(rawSegment),
      raw_transcript_segment: rawSegment,
      keywords,
      related_to_past_7days: relatedToPast,
      source: 'post_call_chunk',
    };

    chunks.push({ content: rawSegment, metadata });
    sequence += 1;
    buffer = [];
  };

  for (const line of transcripts) {
    const currentLength = buffer.reduce((acc, t) => acc + t.text.length, 0);

    // 새 청크 조건: 길이 초과시만 청크 분리 (전체 대화를 최대한 유지)
    if (buffer.length > 0 && currentLength + line.text.length > chunkSize) {
      flushBuffer();
    }

    buffer.push({ speaker: line.speaker, text: line.text });
  }

  flushBuffer();
  return chunks;
}

function extractKeywords(text: string): string[] {
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 1);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      unique.push(w);
    }
  }
  return unique.slice(0, 10);
}

function checkRelatedToPast(keywords: string[], pastContext: string): boolean {
  if (!pastContext) return false;
  const lowerContext = pastContext.toLowerCase();
  return keywords.some(kw => lowerContext.includes(kw.toLowerCase()));
}

function inferTopic(rawSegment: string): string {
  const firstLine = rawSegment.split('\n')[0] || '';
  const snippet = firstLine.replace(/\[.*?\]:\s*/, '').trim();
  return snippet.substring(0, 30) || '대화 요약';
}
