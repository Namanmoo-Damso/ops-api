export type CallAnalysisResult = {
  summary: string;
  mood: 'positive' | 'neutral' | 'negative';
  moodScore: number;
  tags: string[];
  healthKeywords: {
    pain: number | null;
    sleep: string | null;
    meal: string | null;
    medication: string | null;
  };
};

export type AnalyzeCallResult = {
  callId: string;
  wardId: string | null;
  summary: string;
  mood: string;
  moodScore: number;
  tags: string[];
  healthKeywords: Record<string, unknown>;
  duration: number | null;
  createdAt: string;
};
