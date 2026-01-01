import { Module, Global } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AuthService } from '../auth';

/**
 * 공통 모듈
 * Guards, Decorators, Filters 등 공통 유틸리티 제공
 *
 * @Global() 데코레이터로 전역 모듈로 등록
 * - JwtAuthGuard, AdminAuthGuard를 다른 모듈에서 주입받아 사용 가능
 * - DbService, PushService, AiService는 각각의 전역 모듈에서 제공됨
 */
@Global()
@Module({
  providers: [
    JwtAuthGuard,
    AdminAuthGuard,
    AuthService,
  ],
  exports: [
    JwtAuthGuard,
    AdminAuthGuard,
    AuthService,
  ],
})
export class CommonModule {}
