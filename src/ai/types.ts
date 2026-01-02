export type AiResponse = {
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

export type CallAnalysisResult =
  | ({ success: true } & AiResponse)
  | { success: false; error: string };

export type AnalyzeCallResult =
  | ({ success: true } & AiResponse & {
      callId: string;
      wardId: string | null;
      duration: number | null;
      createdAt: string;
    })
  | {
      success: false;
      callId: string;
      error: string;
    };

