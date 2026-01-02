import { CallAnalysisResult } from './types';

export interface AiAnalysisProvider {
  analyze(transcript: string): Promise<CallAnalysisResult>;
}
