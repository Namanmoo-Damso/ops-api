import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { DbService } from '../database';

type CallAnalysisResult = {
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

type AnalyzeCallResult = {
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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI | null;

  constructor(private readonly dbService: DbService) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log('OpenAI client initialized');
    } else {
      this.openai = null;
      this.logger.warn('OPENAI_API_KEY not set, AI analysis will use mock data');
    }
  }

  async analyzeCall(callId: string): Promise<AnalyzeCallResult> {
    this.logger.log(`analyzeCall callId=${callId}`);

    // 1. 통화 정보 가져오기
    const callInfo = await this.dbService.getCallForAnalysis(callId);
    if (!callInfo) {
      throw new Error(`Call not found: ${callId}`);
    }

    // 2. AI 분석 (또는 Mock)
    let analysis: CallAnalysisResult;
    if (this.openai) {
      analysis = await this.analyzeWithOpenAI(callInfo.transcript || '');
    } else {
      analysis = this.getMockAnalysis();
    }

    // 3. call_summaries 저장
    const summary = await this.dbService.createCallSummary({
      callId,
      wardId: callInfo.ward_id,
      summary: analysis.summary,
      mood: analysis.mood,
      moodScore: analysis.moodScore,
      tags: analysis.tags,
      healthKeywords: analysis.healthKeywords,
    });

    // 4. 건강 알림 체크 및 생성
    if (callInfo.ward_id && callInfo.guardian_id) {
      await this.checkHealthAlerts(callInfo.ward_id, callInfo.guardian_id, analysis);
    }

    this.logger.log(`analyzeCall completed callId=${callId} mood=${analysis.mood}`);

    return {
      callId,
      wardId: callInfo.ward_id,
      summary: analysis.summary,
      mood: analysis.mood,
      moodScore: analysis.moodScore,
      tags: analysis.tags,
      healthKeywords: analysis.healthKeywords,
      duration: callInfo.duration,
      createdAt: summary.analyzed_at,
    };
  }

  private async analyzeWithOpenAI(transcript: string): Promise<CallAnalysisResult> {
    if (!this.openai) {
      return this.getMockAnalysis();
    }

    const systemPrompt = `당신은 어르신과 AI(다미)의 대화를 분석하는 전문가입니다.
다음 JSON 형식으로 분석 결과를 반환해주세요:
{
  "summary": "대화 요약 (2-3문장, 한국어)",
  "mood": "positive" | "neutral" | "negative",
  "moodScore": 0.0 ~ 1.0 (감정 점수, 1이 가장 긍정적),
  "tags": ["키워드1", "키워드2", ...] (최대 5개, 한국어),
  "healthKeywords": {
    "pain": 언급 횟수 (숫자) 또는 null,
    "sleep": "good" | "bad" | "mentioned" 또는 null,
    "meal": "regular" | "irregular" | "mentioned" 또는 null,
    "medication": "compliant" | "non-compliant" | "mentioned" 또는 null
  }
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript || '(대화 내용 없음)' },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn('OpenAI returned empty response, using mock data');
        return this.getMockAnalysis();
      }

      const result = JSON.parse(content) as CallAnalysisResult;
      return {
        summary: result.summary || '',
        mood: result.mood || 'neutral',
        moodScore: Math.max(0, Math.min(1, result.moodScore || 0.5)),
        tags: Array.isArray(result.tags) ? result.tags.slice(0, 5) : [],
        healthKeywords: {
          pain: result.healthKeywords?.pain ?? null,
          sleep: result.healthKeywords?.sleep ?? null,
          meal: result.healthKeywords?.meal ?? null,
          medication: result.healthKeywords?.medication ?? null,
        },
      };
    } catch (error) {
      this.logger.error(`OpenAI analysis failed: ${(error as Error).message}`);
      return this.getMockAnalysis();
    }
  }

  private getMockAnalysis(): CallAnalysisResult {
    return {
      summary: '어르신께서 오늘 날씨가 좋다고 말씀하시며 즐거워하셨습니다. 손주들 이야기를 하시며 웃으셨고, 건강 상태는 양호해 보입니다.',
      mood: 'positive',
      moodScore: 0.85,
      tags: ['날씨', '손주', '긍정적'],
      healthKeywords: {
        pain: null,
        sleep: 'good',
        meal: 'regular',
        medication: null,
      },
    };
  }

  private async checkHealthAlerts(
    wardId: string,
    guardianId: string,
    analysis: CallAnalysisResult,
  ) {
    // 통증 관련 체크
    if (analysis.healthKeywords.pain && analysis.healthKeywords.pain > 0) {
      // 최근 3일 통증 언급 횟수 확인
      const recentPainCount = await this.dbService.getRecentPainMentions(wardId, 3);
      if (recentPainCount >= 2) {
        await this.dbService.createHealthAlert({
          wardId,
          guardianId,
          alertType: 'warning',
          message: `${recentPainCount + 1}일 연속 통증 관련 단어가 감지되었습니다`,
        });
        this.logger.log(`Health alert created wardId=${wardId} type=pain count=${recentPainCount + 1}`);
      }
    }

    // 부정적 감정 체크
    if (analysis.mood === 'negative' && analysis.moodScore < 0.3) {
      await this.dbService.createHealthAlert({
        wardId,
        guardianId,
        alertType: 'info',
        message: '어르신의 기분이 좋지 않아 보입니다. 관심이 필요합니다.',
      });
      this.logger.log(`Health alert created wardId=${wardId} type=mood`);
    }
  }
}
