import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth';
import { DbService } from '../../database';

@Injectable()
export class AdminOrganizationGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly dbService: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid authorization header',
      );
    }

    const token = authorization.slice(7);

    let payload: { sub: string; email: string; role: string; type: string };
    try {
      payload = this.authService.verifyAdminAccessToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired admin access token');
    }

    const admin = await this.dbService.findAdminById(payload.sub);
    if (!admin || !admin.is_active) {
      throw new ForbiddenException(
        '관리자 계정을 찾을 수 없거나 비활성화되었습니다.',
      );
    }

    const organizationId =
      request.body?.organizationId?.trim?.() ||
      request.query?.organizationId?.trim?.() ||
      request.params?.organizationId?.trim?.();

    if (
      organizationId &&
      admin.role !== 'super_admin' &&
      admin.organization_id !== organizationId
    ) {
      throw new ForbiddenException('해당 조직에 대한 권한이 없습니다.');
    }

    request.admin = {
      ...payload,
      organization_id: admin.organization_id,
      is_active: admin.is_active,
    };

    return true;
  }
}
