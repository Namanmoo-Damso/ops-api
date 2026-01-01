import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type CurrentUserPayload = {
  sub: string;
  type: 'access' | 'refresh';
  userType?: 'guardian' | 'ward';
};

export type CurrentAdminPayload = {
  sub: string;
  email: string;
  role: string;
  type: string;
};

/**
 * 현재 인증된 사용자 정보를 추출하는 데코레이터
 * JwtAuthGuard와 함께 사용
 *
 * @example
 * @UseGuards(JwtAuthGuard)
 * @Get('/me')
 * getMe(@CurrentUser() user: CurrentUserPayload) {
 *   return this.usersService.findById(user.sub);
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/**
 * 현재 인증된 관리자 정보를 추출하는 데코레이터
 * AdminAuthGuard와 함께 사용
 *
 * @example
 * @UseGuards(AdminAuthGuard)
 * @Get('/admin/dashboard')
 * getDashboard(@CurrentAdmin() admin: CurrentAdminPayload) {
 *   return this.dashboardService.getStats(admin.sub);
 * }
 */
export const CurrentAdmin = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentAdminPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.admin;
  },
);
