/**
 * RAG Queue Module
 *
 * BullMQ 기반 RAG 인덱싱 큐 모듈
 * - BullMQ 설정 및 큐 등록
 * - Bull Board UI를 /admin/queues 경로에 마운트
 * - Basic Auth로 UI 접근 보호
 *
 * 환경변수:
 * - REDIS_URL: Redis 연결 URL
 * - ADMIN_USER: Bull Board UI 사용자명
 * - ADMIN_PASS: Bull Board UI 비밀번호
 */
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { Request, Response, NextFunction } from 'express';

import { RagIndexingProducer } from './rag-indexing.producer';
import { RagIndexingProcessor } from './rag-indexing.processor';
import { RAG_INDEXING_QUEUE } from './rag-queue.constants';
import { parseRedisUrl } from '../../common/utils/redis.utils';

// Bull Board Express 어댑터 인스턴스 (싱글톤)
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

@Module({
  imports: [
    // BullMQ 큐 등록
    BullModule.registerQueue({
      name: RAG_INDEXING_QUEUE,
      defaultJobOptions: {
        // 작업 실패 시 재시도 설정
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5초부터 시작하여 지수 증가 (5s, 10s, 20s)
        },
        // 완료/실패 작업 로그 보관
        removeOnComplete: {
          age: 24 * 3600, // 24시간 후 삭제
          count: 1000,    // 최대 1000개 보관
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // 7일 후 삭제
          count: 5000,        // 최대 5000개 보관
        },
      },
    }),
  ],
  providers: [RagIndexingProducer, RagIndexingProcessor],
  exports: [RagIndexingProducer],
})
export class RagQueueModule implements NestModule {
  private bullBoardInitialized = false;

  constructor() {
    // Bull Board는 configure에서 초기화
  }

  /**
   * Bull Board UI 미들웨어 설정
   * /admin/queues 경로에 Basic Auth + Bull Board UI 마운트
   */
  configure(consumer: MiddlewareConsumer) {
    const { username: adminUser, password: adminPass } =
      this.getAdminCredentials();

    // Basic Auth 미들웨어
    const basicAuthMiddleware = (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      // Authorization 헤더 확인
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
        res.status(401).send('Authentication required');
        return;
      }

      // Base64 디코딩 및 자격 증명 확인
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString(
        'ascii',
      );
      const [username, password] = credentials.split(':');

      if (username === adminUser && password === adminPass) {
        next();
      } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
        res.status(401).send('Invalid credentials');
      }
    };

    // Bull Board 초기화 (한 번만 실행)
    if (!this.bullBoardInitialized) {
      this.initializeBullBoard();
      this.bullBoardInitialized = true;
    }

    // /admin/queues 경로에 미들웨어 적용
    consumer
      .apply(basicAuthMiddleware, serverAdapter.getRouter())
      .forRoutes('/admin/queues');
  }

  /**
   * Bull Board 초기화
   * 큐를 Bull Board에 등록
   */
  private initializeBullBoard() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisOptions = parseRedisUrl(redisUrl);

    // BullMQ Queue 인스턴스 생성 (Bull Board용)
    const ragIndexingQueue = new Queue(RAG_INDEXING_QUEUE, {
      connection: redisOptions,
    });

    // Bull Board 생성 및 큐 등록
    createBullBoard({
      queues: [new BullMQAdapter(ragIndexingQueue)],
      serverAdapter,
    });
  }

  private getAdminCredentials(): { username: string; password: string } {
    const username = process.env.ADMIN_USER;
    const password = process.env.ADMIN_PASS;

    if (!username || !password) {
      throw new Error(
        'ADMIN_USER and ADMIN_PASS must be set to enable Bull Board.',
      );
    }

    return { username, password };
  }
}
