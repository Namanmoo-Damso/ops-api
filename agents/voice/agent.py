"""
소담이 에이전트 클래스
(기존 simple_agent.py 대체)

이 파일에는 에이전트 로직만 포함됩니다.
실행은 main.py에서 합니다.
"""

from dataclasses import dataclass, field
from typing import Optional
import logging

from livekit.agents import Agent, ChatContext, RunContext, function_tool

logger = logging.getLogger("sodam.agent")


# ============================================================================
# 세션 데이터
# ============================================================================

@dataclass
class SodamUserData:
    """소담이 세션별 사용자 데이터"""
    user_name: Optional[str] = None
    conversation_count: int = 0
    previous_topics: list = field(default_factory=list)
    mood: Optional[str] = None


# ============================================================================
# 소담이 에이전트
# ============================================================================

class SodamAgent(Agent):
    """
    소담이 - 한국 어르신을 위한 따뜻한 AI 동반자
    """
    
    def __init__(self, chat_ctx: Optional[ChatContext] = None):
        super().__init__(
            instructions=self._get_instructions(),
            chat_ctx=chat_ctx,
        )
    
    def _get_instructions(self) -> str:
        return """당신은 "소담이"입니다. 한국 어르신들의 따뜻한 AI 동반자예요.

# 핵심 규칙
- 반드시 한국어로만 대화하세요
- 항상 존댓말(높임말)을 사용하세요
- 짧고 따뜻하게 답하세요 (1-2문장)
- 영어는 절대 사용하지 마세요

# 말투 예시
- "안녕하세요, 어르신~"
- "아이고, 그러셨군요~"
- "네네, 잘 들었어요~"
- "오늘 식사는 맛있게 하셨어요?"

# 대화 스타일
- 어르신 말씀에 공감하며 들어주세요
- "네~", "아이고~", "그러셨군요~" 같은 추임새를 사용하세요
- 질문은 한 번에 하나만, 자연스럽게
- 말이 끊겨도 참을성 있게 기다려주세요

# 주요 대화 주제
- 오늘 하루 어떻게 보내셨는지
- 식사는 맛있게 하셨는지
- 건강은 괜찮으신지
- 날씨 이야기
- 가족 이야기, 옛날 추억

# 중요 주의사항
- 어르신이 말씀 중이시면 끊지 말고 끝까지 들으세요
- 대답이 늦어도 재촉하지 마세요
- 의료 조언은 하지 마세요 (병원 방문 권유만)
- 따뜻하고 편안한 분위기를 유지하세요"""

    async def on_enter(self) -> None:
        """에이전트가 세션에 들어올 때 - 인사말"""
        logger.info("소담이 에이전트 활성화됨")
        
        await self.session.generate_reply(
            instructions=(
                "따뜻하게 인사하고 오늘 어떻게 지내셨는지 여쭤보세요. "
                "한국어 존댓말로, 1-2문장으로 짧게. "
                "예: '안녕하세요, 어르신~ 오늘 하루 어떻게 보내고 계세요?'"
            )
        )

    # =========================================================================
    # 도구 (추후 기능 확장용)
    # =========================================================================
    
    @function_tool()
    async def remember_topic(
        self,
        context: RunContext[SodamUserData],
        topic: str,
    ) -> str:
        """어르신이 말씀하신 중요한 주제를 기억합니다.
        
        Args:
            topic: 기억할 주제 (예: "손자 민수", "허리 통증", "김치찌개")
        """
        if context.userdata:
            context.userdata.previous_topics.append(topic)
            context.userdata.conversation_count += 1
            logger.info(f"주제 저장: {topic}")
        return f"'{topic}'를 기억했어요."

    @function_tool()
    async def check_wellbeing(
        self,
        context: RunContext[SodamUserData],
        aspect: str,
    ) -> str:
        """어르신의 안부를 확인하고 기록합니다.
        
        Args:
            aspect: 확인한 항목 ("식사", "수면", "건강", "기분")
        """
        logger.info(f"안부 확인: {aspect}")
        return f"어르신의 {aspect} 상태를 확인했어요."