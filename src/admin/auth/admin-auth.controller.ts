import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AuthService } from '../../auth';
import { DbService } from '../../database';

@Controller('admin')
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name);

  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly authService: AuthService,
    private readonly dbService: DbService,
  ) {}

  @Post('auth/oauth/code')
  async oauthCodeExchange(
    @Body() body: { provider?: string; code?: string; redirectUri?: string },
  ) {
    const provider = body.provider?.trim().toLowerCase();
    const code = body.code?.trim();
    const redirectUri = body.redirectUri?.trim();

    if (!provider || !code || !redirectUri) {
      throw new HttpException(
        'provider, code, and redirectUri are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (provider !== 'kakao' && provider !== 'google') {
      throw new HttpException(
        'provider must be kakao or google',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`oauthCodeExchange provider=${provider}`);

    try {
      const accessToken = await this.adminAuthService.exchangeCodeForToken(
        provider,
        code,
        redirectUri,
      );
      const oauthUser = await this.adminAuthService.verifyOAuthToken(
        provider,
        accessToken,
      );
      return await this.adminAuthService.processOAuthLogin(oauthUser, provider);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        `oauthCodeExchange failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'OAuth 인증에 실패했습니다.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post('auth/oauth')
  async oauthLogin(@Body() body: { provider?: string; accessToken?: string }) {
    const provider = body.provider?.trim().toLowerCase();
    const accessToken = body.accessToken?.trim();

    if (!provider || !accessToken) {
      throw new HttpException(
        'provider and accessToken are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (provider !== 'kakao' && provider !== 'google') {
      throw new HttpException(
        'provider must be kakao or google',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`oauthLogin provider=${provider}`);

    try {
      const oauthUser = await this.adminAuthService.verifyOAuthToken(
        provider,
        accessToken,
      );
      return await this.adminAuthService.processOAuthLogin(oauthUser, provider);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`oauthLogin failed error=${(error as Error).message}`);
      throw new HttpException(
        'OAuth 인증에 실패했습니다.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post('auth/refresh')
  async refreshToken(@Body() body: { refreshToken?: string }) {
    const refreshToken = body.refreshToken?.trim();

    if (!refreshToken) {
      throw new HttpException(
        'refreshToken is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const tokenHash = this.authService.hashToken(refreshToken);
      const storedToken = await this.dbService.findAdminRefreshToken(tokenHash);

      if (!storedToken) {
        throw new HttpException(
          '유효하지 않은 리프레시 토큰입니다.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const admin = await this.dbService.findAdminById(storedToken.admin_id);
      if (!admin || !admin.is_active) {
        await this.dbService.deleteAdminRefreshToken(tokenHash);
        throw new HttpException(
          '계정이 비활성화되었습니다.',
          HttpStatus.FORBIDDEN,
        );
      }

      await this.dbService.deleteAdminRefreshToken(tokenHash);

      const jwtPayload = {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        type: 'admin',
      };

      const newAccessToken = this.authService.signAdminAccessToken(jwtPayload);
      const newRefreshToken =
        this.authService.signAdminRefreshToken(jwtPayload);

      const newTokenHash = this.authService.hashToken(newRefreshToken);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await this.dbService.createAdminRefreshToken(
        admin.id,
        newTokenHash,
        expiresAt,
      );

      this.logger.log(`refreshToken success adminId=${admin.id}`);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`refreshToken failed error=${(error as Error).message}`);
      throw new HttpException(
        '토큰 갱신에 실패했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('auth/logout')
  async logout(@Body() body: { refreshToken?: string }) {
    const refreshToken = body.refreshToken?.trim();

    if (refreshToken) {
      const tokenHash = this.authService.hashToken(refreshToken);
      await this.dbService.deleteAdminRefreshToken(tokenHash);
    }

    return { success: true };
  }

  @Get('organizations')
  async listOrganizations() {
    const organizations = await this.dbService.listAllOrganizations();
    return {
      organizations: organizations.map(org => ({
        id: org.id,
        name: org.name,
      })),
    };
  }

  @Post('organizations/find-or-create')
  async findOrCreateOrganization(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { name?: string },
  ) {
    const accessToken = authorization?.replace('Bearer ', '').trim();
    const name = body.name?.trim();

    if (!accessToken) {
      throw new HttpException(
        'Authorization header is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!name) {
      throw new HttpException('name is required', HttpStatus.BAD_REQUEST);
    }

    try {
      this.authService.verifyAdminAccessToken(accessToken);
    } catch {
      throw new HttpException('Invalid token', HttpStatus.UNAUTHORIZED);
    }

    const result = await this.dbService.findOrCreateOrganization(name);
    this.logger.log(
      `findOrCreateOrganization name=${name} created=${result.created}`,
    );

    return {
      organization: {
        id: result.organization.id,
        name: result.organization.name,
      },
      created: result.created,
    };
  }

  @Put('me/organization')
  async updateOrganization(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { organizationId?: string },
  ) {
    const accessToken = authorization?.replace('Bearer ', '').trim();
    const organizationId = body.organizationId?.trim();

    if (!accessToken) {
      throw new HttpException(
        'Authorization header is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!organizationId) {
      throw new HttpException(
        'organizationId is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const payload = this.authService.verifyAdminAccessToken(accessToken);
      const admin = await this.dbService.findAdminById(payload.sub);

      if (!admin || !admin.is_active) {
        throw new HttpException(
          '계정을 찾을 수 없거나 비활성화되었습니다.',
          HttpStatus.FORBIDDEN,
        );
      }

      const organization =
        await this.dbService.findOrganization(organizationId);
      if (!organization) {
        throw new HttpException(
          '조직을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      await this.dbService.updateAdminOrganization(admin.id, organizationId);
      this.logger.log(
        `updateOrganization adminId=${admin.id} organizationId=${organizationId}`,
      );

      return {
        success: true,
        organization: {
          id: organization.id,
          name: organization.name,
        },
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      throw new HttpException(
        '조직 선택에 실패했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('me')
  async getMe(@Headers('authorization') authorization: string | undefined) {
    const accessToken = authorization?.replace('Bearer ', '').trim();

    if (!accessToken) {
      throw new HttpException(
        'Authorization header is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const payload = this.authService.verifyAdminAccessToken(accessToken);
      const admin = await this.dbService.findAdminById(payload.sub);

      if (!admin || !admin.is_active) {
        throw new HttpException(
          '계정을 찾을 수 없거나 비활성화되었습니다.',
          HttpStatus.FORBIDDEN,
        );
      }

      const permissions = await this.dbService.getAdminPermissions(admin.id);

      return {
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          organizationId: admin.organization_id,
          permissions,
        },
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      throw new HttpException('인증에 실패했습니다.', HttpStatus.UNAUTHORIZED);
    }
  }
}
