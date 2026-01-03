"""
소담이 Voice Agent - 메인 엔트리포인트
LiveKit Agent v1.3+ API

이 파일은 Docker 컨테이너에서 실행되는 엔트리포인트입니다.
실제 에이전트 로직은 agent.py에 있습니다.

실행 방법:
    python main.py download-files  # 모델 다운로드 (최초 1회)
    python main.py dev             # 개발 모드
    python main.py start           # 프로덕션 모드
"""

import sys
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import AgentServer, AgentSession, cli
from livekit.agents.voice import room_io
from livekit.plugins import silero
import logging

# 로컬 모듈
from config import validate_env_vars, get_optional_config, ConfigError
from agent import SodamAgent, SodamUserData

# AWS 플러그인
try:
    from livekit.plugins import aws
except ImportError:
    print("❌ livekit-plugins-aws 패키지가 필요합니다")
    print("   설치: pip install livekit-plugins-aws")
    sys.exit(1)


# ============================================================================
# 환경 설정
# ============================================================================

# Load environment variables
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# Validate configuration
try:
    env_config = validate_env_vars()
    optional_config = get_optional_config()
except ConfigError as e:
    print(f"❌ Configuration Error: {e}", file=sys.stderr)
    sys.exit(1)

# Logging
log_level = getattr(logging, optional_config["LOG_LEVEL"].upper(), logging.INFO)
logging.basicConfig(
    level=log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("sodam.main")


# ============================================================================
# 에이전트 서버
# ============================================================================

server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx):
    """
    LiveKit 룸 연결 시 실행되는 엔트리포인트
    """
    logger.info(f"🌸 소담이가 방에 입장합니다: {ctx.room.name}")
    
    # 룸 연결
    await ctx.connect()
    
    # 메타데이터 설정 (프론트엔드에서 에이전트 식별용)
    await ctx.room.local_participant.set_metadata(
        '{"type": "agent", "name": "소담이", "language": "ko"}'
    )
    
    # =========================================================================
    # AgentSession 설정
    # =========================================================================
    session = AgentSession[SodamUserData](
        # VAD: 어르신 말속도 고려
        vad=silero.VAD.load(
            min_speech_duration=0.1,
            min_silence_duration=0.8,
            prefix_padding_duration=0.5,
        ),
        
        # STT: Amazon Transcribe 한국어
        stt=aws.STT(language="ko-KR"),
        
        # LLM: AWS Bedrock Claude
        llm=aws.LLM(
            model=optional_config.get("SODAM_LLM_MODEL", "anthropic.claude-sonnet-4-20250514-v1:0"),
            temperature=0.7,
        ),
        
        # TTS: Amazon Polly 한국어
        tts=aws.TTS(
            voice=optional_config.get("SODAM_VOICE", "Seoyeon"),
        ),
        
        # Turn Detection
        turn_detection="vad",
        
        # 타이밍 (어르신 말속도 고려)
        min_endpointing_delay=0.8,
        max_endpointing_delay=6.0,
        
        # 인터럽션
        allow_interruptions=True,
        min_interruption_duration=0.8,
        false_interruption_timeout=2.5,
        resume_false_interruption=True,
        
        # 사용자 데이터
        userdata=SodamUserData(),
    )
    
    # =========================================================================
    # 세션 시작
    # =========================================================================
    await session.start(
        room=ctx.room,
        agent=SodamAgent(),
        room_options=room_io.RoomOptions(
            audio_input=True,
            video_input=False,
            text_output=room_io.TextOutputOptions(
                sync_transcription=True,
            ),
        ),
    )
    
    logger.info(f"✅ 소담이 준비 완료: {ctx.room.name}")


# ============================================================================
# 실행
# ============================================================================

if __name__ == "__main__":
    print()
    print("🌸" + "=" * 58 + "🌸")
    print("   소담이 - 한국 어르신 음성 AI 동반자")
    print("🌸" + "=" * 58 + "🌸")
    print()
    
    try:
        cli.run_app(server)
    except KeyboardInterrupt:
        logger.info("👋 소담이가 종료됩니다...")
        sys.exit(0)
    except Exception as e:
        logger.error(f"❌ 오류 발생: {e}")
        sys.exit(1)