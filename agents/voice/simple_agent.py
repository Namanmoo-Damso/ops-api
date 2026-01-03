import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)

from livekit.agents.voice import Agent, AgentSession
from livekit.plugins import aws, silero
import logging

from config import validate_env_vars, get_optional_config, ConfigError

# Load environment variables
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

# Validate environment variables before proceeding
try:
    env_config = validate_env_vars()
    optional_config = get_optional_config()
except ConfigError as e:
    print(f"❌ Configuration Error: {e}", file=sys.stderr)
    sys.exit(1)

# Set logging level from environment
log_level = getattr(logging, optional_config["LOG_LEVEL"].upper(), logging.INFO)
logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def entrypoint(ctx: JobContext):
    """
    Main entrypoint for the AI agent when joining a room.

    Args:
        ctx: JobContext from LiveKit agent framework
    """
    try:
        logger.info(f"Simple AI Agent starting in room: {ctx.room.name}")

        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    except Exception as e:
        logger.error(f"Failed to connect to room {ctx.room.name}: {e}")
        raise

    agent = Agent(
        instructions=(
            "You are a warm, caring AI companion for elderly Korean users.\n\n"
            "# CRITICAL RULE: Language\n"
            "- User speaks: Korean (한국어)\n"
            "- You MUST respond: ONLY in Korean (한국어) using respectful 존댓말\n"
            "- NEVER respond in English - ALWAYS Korean\n"
            "- Example correct: '안녕하세요, 어르신'\n"
            "- Example WRONG: 'Hello' or any English\n\n"
            "# Output rules\n"
            "- Use respectful Korean speech (존댓말) at all times\n"
            "- Keep responses brief: one to two sentences\n"
            "- Respond naturally to what they say\n"
            "- Be warm and caring in tone\n\n"
            "# Conversational flow\n"
            "- Listen more than you speak\n"
            "- Respond to their stories with empathy\n"
            "- Share relevant observations about wellbeing, meals, activities\n"
            "- Only ask questions when it naturally fits\n\n"
            "# Handling interruptions\n"
            "- If interrupted, stop and listen\n"
            "- Acknowledge gracefully: '네, 말씀하세요'\n\n"
            "# Topics\n"
            "- Daily activities and meals\n"
            "- Health and feelings\n"
            "- Family and memories\n"
            "- Weather and seasons"
        ),
        # ✅ Configure models IN THE AGENT (not session) for proper instruction binding
        stt=aws.STT(language="ko-KR"),  # Amazon Transcribe - Korean
        llm=aws.LLM(
            model="global.anthropic.claude-haiku-4-5-20251001-v1:0",  # Bedrock Claude 4.5 Haiku (cross-region)
            temperature=0.7,
        ),
        tts=aws.TTS(
            voice="Seoyeon",  # Amazon Polly - 한국어 여성 음성 (neural engine 기본)
        ),
        vad=silero.VAD.load(
            min_speech_duration=0.3,  # 최소 0.3초 이상 음성이어야 인식 (노이즈 필터)
            min_silence_duration=1.0,  # 어르신들 느린 속도 고려
            activation_threshold=0.7,  # 음성 감지 임계값 (0.7 = 70% 확률 이상만 음성)
        ),
        # Timing optimizations - REDUCE transcript delay
        allow_interruptions=True,
        min_endpointing_delay=1.0,  # REDUCED: Wait only 0.5s before responding (was 1.0s)
        max_endpointing_delay=5.0,  # 어르신들 느린 속도 고려
    )

    session = AgentSession(
        # Additional session-level settings
        min_interruption_duration=1.2,
        min_interruption_words=2,
        false_interruption_timeout=3.0,
        resume_false_interruption=True,
        discard_audio_if_uninterruptible=False,
        # TTS-aligned transcription for iOS subtitles
        use_tts_aligned_transcript=True,
    )

    try:
        await session.start(agent, room=ctx.room)

        # Greeting in Korean (not English!)
        session.say("안녕하세요, 어르신. 오늘 어떻게 지내셨어요?")

        logger.info(f"Agent ready and listening in room: {ctx.room.name}")
    except Exception as e:
        logger.error(f"Failed to start agent session: {e}")
        raise


async def request_fnc(ctx):
    """
    Automatically accept job requests when a room is created.
    This allows the agent to join rooms without explicit dispatch.
    """
    logger.info(f"Received job request for room: {ctx.room.name}")
    # Accept all job requests - agent will join any room
    await ctx.accept()


if __name__ == "__main__":
    print("=" * 50)
    print("KOREAN VOICE ASSISTANT FOR ELDERLY CARE")
    print("=" * 50)
    try:
        cli.run_app(
            WorkerOptions(
                entrypoint_fnc=entrypoint,
                request_fnc=request_fnc,
                agent_name="voice-agent",  # Agent name for explicit dispatch
            )
        )
    except KeyboardInterrupt:
        logger.info("Agent stopped by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
