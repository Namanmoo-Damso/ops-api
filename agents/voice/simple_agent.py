"""
Korean Voice AI Agent for Elderly Care.

LiveKit Agents 1.3.10 - AgentServer pattern
"""
import os
import sys
import logging
from pathlib import Path

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    RoomInputOptions,
    cli,
)
from livekit.plugins import aws, silero

from config import validate_env_vars, get_optional_config, ConfigError
from agents import ElderlyCompanionAgent
from userdata import SessionUserdata

# Load environment variables
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

# Validate environment variables before proceeding
try:
    env_config = validate_env_vars()
    optional_config = get_optional_config()
except ConfigError as e:
    print(f"Configuration Error: {e}", file=sys.stderr)
    sys.exit(1)

# Set logging level from environment
log_level = getattr(logging, optional_config["LOG_LEVEL"].upper(), logging.INFO)
logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# API base URL for backend calls
API_BASE = os.getenv("API_BASE_URL", "http://localhost:3000")

# Create AgentServer instance
server = AgentServer()


def prewarm(proc: JobProcess):
    """
    Prewarm function - runs once when the worker starts.

    Use this to load models that should be shared across sessions.
    """
    logger.info("Prewarming: Loading VAD model...")
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.3,
        min_silence_duration=1.0,
        activation_threshold=0.7,
    )
    logger.info("Prewarm complete")


# Register prewarm function
server.setup_fnc = prewarm


def extract_ward_id(room) -> str:
    """
    Extract ward ID from room information.

    Room name format: "call_{ward_id}_{timestamp}" or similar
    """
    room_name = room.name
    if "_" in room_name:
        parts = room_name.split("_")
        if len(parts) >= 2:
            return parts[1]
    return room_name


async def prefetch_context(ward_id: str) -> str:
    """
    Pre-fetch context for the ward (optional, for hybrid RAG mode).

    Returns recent conversation summaries if available.
    """
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{API_BASE}/v1/rag/prefetch/{ward_id}",
                timeout=0.5,
            )
            if res.status_code == 200:
                return res.json().get("context", "")
    except Exception as e:
        logger.warning(f"Prefetch context failed: {e}")
    return ""


async def trigger_rag_indexing(call_id: str, ward_id: str):
    """Trigger RAG indexing after session ends."""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{API_BASE}/v1/rag/index",
                json={
                    "callId": call_id,
                    "wardId": ward_id,
                },
                timeout=5.0,
            )
            logger.info(f"RAG indexing triggered: call={call_id}")
    except Exception as e:
        logger.error(f"RAG indexing trigger failed: {e}")


async def trigger_call_analysis(call_id: str):
    """Trigger call analysis after session ends."""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{API_BASE}/v1/calls/{call_id}/analyze",
                timeout=5.0,
            )
            logger.info(f"Call analysis triggered: call={call_id}")
    except Exception as e:
        logger.error(f"Call analysis trigger failed: {e}")


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    """
    Main entrypoint for the AI agent when joining a room.

    Uses AgentServer decorator pattern (LiveKit 1.3+).
    """
    logger.info(f"Agent starting in room: {ctx.room.name}")

    # Extract identifiers
    ward_id = extract_ward_id(ctx.room)
    call_id = ctx.room.name

    logger.info(f"Session info: ward_id={ward_id}, call_id={call_id}")

    # Create session userdata
    userdata = SessionUserdata(
        ward_id=ward_id,
        call_id=call_id,
    )

    # Create agent session with userdata
    session = AgentSession[SessionUserdata](
        userdata=userdata,
        stt=aws.STT(language="ko-KR"),
        llm=aws.LLM(
            model="global.anthropic.claude-haiku-4-5-20251001-v1:0",
            temperature=0.7,
        ),
        tts=aws.TTS(voice="Seoyeon"),
        vad=ctx.proc.userdata["vad"],  # Use prewarmed VAD
        # Session timing settings
        min_endpointing_delay=1.0,
        max_endpointing_delay=5.0,
    )

    # Event: User transcript received
    @session.on("user_input_transcribed")
    def on_user_transcript(ev):
        """Capture user transcripts in real-time."""
        if ev.is_final:
            userdata.add_transcript("user", ev.transcript)
            logger.debug(f"User transcript: {ev.transcript}")

    # Event: Agent speech
    @session.on("agent_speech_committed")
    def on_agent_speech(ev):
        """Capture agent responses."""
        if hasattr(ev, 'content') and ev.content:
            userdata.add_transcript("agent", ev.content)
            logger.debug(f"Agent response: {ev.content}")

    # Event: Session end
    @session.on("session_end")
    async def on_session_end(report):
        """
        Handle session end - trigger analysis and indexing.

        SessionReport contains:
        - session_id
        - duration
        - turns (list of conversation turns)
        """
        logger.info(f"Session ended: {report.session_id if hasattr(report, 'session_id') else call_id}")
        logger.info(f"Total transcripts: {len(userdata.transcripts)}")

        # Trigger async tasks (don't block shutdown)
        try:
            await trigger_rag_indexing(call_id, ward_id)
            await trigger_call_analysis(call_id)
        except Exception as e:
            logger.error(f"Post-session tasks failed: {e}")

    # Create agent instance
    agent = ElderlyCompanionAgent(ward_id=ward_id)

    # Start session with room options
    await session.start(
        agent=agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(
            # Keep session alive briefly on disconnect (browser refresh)
            close_on_disconnect=False,
        ),
    )

    # Connect to room
    await ctx.connect()

    # Greeting
    session.say("안녕하세요, 어르신. 오늘 어떻게 지내셨어요?")

    logger.info(f"Agent ready in room: {ctx.room.name}")


if __name__ == "__main__":
    print("=" * 50)
    print("KOREAN VOICE ASSISTANT FOR ELDERLY CARE")
    print("LiveKit Agents 1.3.10 - AgentServer")
    print("=" * 50)
    try:
        cli.run_app(server)
    except KeyboardInterrupt:
        logger.info("Agent stopped by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)
