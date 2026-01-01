import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth';

/**
 * 일반 사용자 JWT 인증 Guard
 * Authorization: Bearer <accessToken> 헤더 검증
 *
 * @example
 * @UseGuards(JwtAuthGuard)
 * @Get('/v1/users/me')
 * getMe(@CurrentUser() user: CurrentUserPayload) { ... }
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authorization.slice(7);
    const payload = this.authService.verifyAccessToken(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // request.user에 payload 저장 (CurrentUser 데코레이터에서 사용)
    request.user = payload;
    return true;
  }
}
