export const DEFAULT_AI_INSTRUCTION = `당신은 어르신과 AI(다미)의 대화를 분석하는 전문가입니다.`;

export const AI_RESPONSE_SCHEMA = `
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

export const DEFAULT_SYSTEM_PROMPT = `${DEFAULT_AI_INSTRUCTION}\n${AI_RESPONSE_SCHEMA}`;
