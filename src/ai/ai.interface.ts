import { CallAnalysisResult } from './types';

export abstract class AiAnalysisProvider {
  abstract analyze(transcript: string): Promise<CallAnalysisResult>;
}

