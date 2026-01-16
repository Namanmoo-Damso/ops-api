/**
 * Worker Entry Point
 *
 * RAG 인덱싱 워커 전용 엔트리포인트
 * HTTP 서버 없이 프로세서만 동작하는 경량 컨텍스트
 *
 * 특징:
 * - HTTP 서버 미사용 (createApplicationContext)
 * - Graceful Shutdown 지원 (SIGTERM, SIGINT)
 * - 진행 중인 작업 안전 종료
 *
 * 실행:
 *   npm run start:worker
 *   또는
 *   node dist/worker.main.js
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

// 로거 인스턴스
const logger = new Logger('IndexingWorker');

// 종료 진행 중 플래그 (중복 처리 방지)
let isShuttingDown = false;

async function bootstrap() {
  logger.log('🚀 RAG 인덱싱 워커 시작 중...');

  // HTTP 서버 없이 애플리케이션 컨텍스트만 생성
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });

  logger.log('✅ 워커 초기화 완료');
  logger.log(`📊 동시 처리: ${process.env.WORKER_CONCURRENCY || 5}개 작업`);
  logger.log(`📡 Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);

  /**
   * Graceful Shutdown 핸들러
   *
   * 프로세스 종료 신호 수신 시:
   * 1. 새 작업 수신 중단
   * 2. 진행 중인 작업 완료 대기 (최대 25초)
   * 3. 리소스 정리 후 종료
   */
  const gracefulShutdown = async (signal: string) => {
    // 중복 호출 방지
    if (isShuttingDown) {
      logger.warn(`⚠️ 이미 종료 진행 중... (signal: ${signal})`);
      return;
    }
    isShuttingDown = true;

    logger.log(`🛑 종료 신호 수신: ${signal}`);
    logger.log('⏳ 진행 중인 작업 완료 대기 중...');

    try {
      // NestJS 애플리케이션 컨텍스트 종료
      // 이 과정에서 BullMQ 워커의 close()가 호출됨
      // close()는 현재 실행 중인 작업이 완료될 때까지 대기
      await app.close();
      logger.log('✅ 워커 정상 종료 완료');
      process.exit(0);
    } catch (error) {
      logger.error(`❌ 종료 중 에러 발생: ${error}`);
      process.exit(1);
    }
  };

  // 종료 신호 핸들러 등록
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // 예기치 못한 에러 핸들링
  process.on('uncaughtException', (error) => {
    logger.error(`❌ Uncaught Exception: ${error.message}`, error.stack);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`❌ Unhandled Rejection: ${reason}`);
    gracefulShutdown('unhandledRejection');
  });

  logger.log('📋 워커 실행 중... (종료: Ctrl+C)');
}

// 워커 시작
bootstrap().catch((error) => {
  logger.error(`❌ 워커 시작 실패: ${error.message}`, error.stack);
  process.exit(1);
});
