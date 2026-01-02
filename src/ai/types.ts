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

export type CallAnalysisSuccess = AiResponse & {
  success: true;
};

export type CallAnalysisFailure = {
  success: false;
  error: string;
};

export type CallAnalysisResult = CallAnalysisSuccess | CallAnalysisFailure;

export type AnalyzeCallSuccess = AiResponse & {
  success: true;
  callId: string;
  wardId: string | null;
  duration: number | null;
  createdAt: string;
};

export type AnalyzeCallFailure = {
  success: false;
  callId: string;
  error: string;
};

export type AnalyzeCallResult = AnalyzeCallSuccess | AnalyzeCallFailure;
