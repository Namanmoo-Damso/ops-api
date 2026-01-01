import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth';

/**
 * 관리자 JWT 인증 Guard
 * Authorization: Bearer <adminAccessToken> 헤더 검증
 *
 * @example
 * @UseGuards(AdminAuthGuard)
 * @Get('/v1/admin/dashboard/stats')
 * getStats(@CurrentAdmin() admin: CurrentAdminPayload) { ... }
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authorization.slice(7);

    try {
      const payload = this.authService.verifyAdminAccessToken(token);
      // request.admin에 payload 저장 (CurrentAdmin 데코레이터에서 사용)
      request.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired admin access token');
    }
  }
}
