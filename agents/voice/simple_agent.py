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

from livekit.agents import voice_assistant
from livekit.plugins import openai, silero
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
    logger.info(f"🤖 Simple AI Agent starting in room: {ctx.room.name}")

    # Connect to the room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Create the voice assistant
    assistant = voice_assistant.VoiceAssistant(
        vad=silero.VAD.load(
            min_speech_duration=0.1,  # Detect speech faster (default 0.25s)
            min_silence_duration=1.0,  # 어르신들 느린 속도 고려
        ),
        stt=openai.STT(language="ko"),  # Korean speech-to-text
        llm=openai.LLM(
            model="gpt-4o-mini", #문맥 이해도가 더 높으며 3.5보다 저렴함
            temperature=0.7,  # Slightly lower for more consistent responses
        ),
        tts=openai.TTS(
            voice="shimmer", # 차분한 여성 목소리, 아니면 echo(중후한 남성)으로 안정감, ElevenLabsTrubo v.25(손녀/손자 따듯한 목소리) 근데 더 비쌈
            speed=0.85,  # 알아 듣기 쉽게 천천히 말하기
        ),
        # Timing optimizations - REDUCE transcript delay
        allow_interruptions=True,
        min_endpointing_delay=1.0,  # REDUCED: Wait only 0.5s before responding (was 1.0s)
        max_endpointing_delay=5.0,  # 어르신들 느린 속도 고려
    )

    # Start the assistant in the room
    assistant.start(ctx.room)

    # Greeting in Korean (not English!)
    await assistant.say("안녕하세요, 어르신. 오늘 어떻게 지내셨어요?", allow_interruptions=True)

    logger.info(f"✅ Agent ready and listening in room: {ctx.room.name}")


if __name__ == "__main__":
    print("=" * 50)
    print("KOREAN VOICE ASSISTANT FOR ELDERLY CARE")
    print("=" * 50)
    try:
        # [Automatic Dispatch 모드]
        # agent_name을 지정하지 않으면 새로 생성되는 모든 방에 자동으로 참여
        # LiveKit이 알아서 Agent를 적절한 방에 배치
        cli.run_app(
            WorkerOptions(
                entrypoint_fnc=entrypoint,
            )
        )
    except KeyboardInterrupt:
        logger.info("Agent stopped by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
