import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';
import { DbService } from './db.service';
import { PrismaService } from '../prisma';
import {
  UserRepository,
  DeviceRepository,
  RoomRepository,
  CallRepository,
  GuardianRepository,
  WardRepository,
  AdminRepository,
  EmergencyRepository,
  LocationRepository,
  DashboardRepository,
} from './repositories';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Database Pool Provider
 * 레거시 코드 호환성을 위해 유지 (추후 제거 예정)
 */
const DatabasePoolProvider = {
  provide: 'DATABASE_POOL',
  useFactory: async (): Promise<Pool> => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('Missing DATABASE_URL');
    }
    const pool = new Pool({ connectionString: databaseUrl });

    // Wait for DB connection
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await pool.query('select 1');
        return pool;
      } catch (error) {
        lastError = error;
        await sleep(1000 + attempt * 500);
      }
    }
    throw lastError;
  },
};

/**
 * Repository Providers
 * 모든 Repository가 Prisma로 전환 완료
 */
const RepositoryProviders = [
  UserRepository,
  DeviceRepository,
  RoomRepository,
  CallRepository,
  GuardianRepository,
  WardRepository,
  AdminRepository,
  EmergencyRepository,
  LocationRepository,
  DashboardRepository,
];

/**
 * 데이터베이스 모듈
 *
 * Repository 패턴으로 분리된 데이터베이스 레이어
 * - DbService: Facade (기존 인터페이스 유지)
 * - 10개 Repository: 모두 Prisma ORM 사용
 *
 * @Global() 데코레이터로 전역 모듈로 등록
 */
@Global()
@Module({
  providers: [
    DatabasePoolProvider, // 레거시 호환성 (추후 제거)
    PrismaService,
    ...RepositoryProviders,
    DbService,
  ],
  exports: [
    'DATABASE_POOL', // 레거시 호환성 (추후 제거)
    PrismaService,
    DbService,
    ...RepositoryProviders,
  ],
})
export class DatabaseModule {}
