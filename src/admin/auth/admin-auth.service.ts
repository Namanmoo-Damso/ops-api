import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { AuthService } from '../../auth';
import { DbService } from '../../database';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly dbService: DbService,
  ) {}

  async verifyOAuthToken(
    provider: string,
    accessToken: string,
  ): Promise<{ providerId: string; email?: string; name?: string }> {
    if (provider === 'kakao') {
      return this.verifyKakaoToken(accessToken);
    } else if (provider === 'google') {
      return this.verifyGoogleToken(accessToken);
    }
    throw new Error(`Unknown provider: ${provider}`);
  }

  private async verifyKakaoToken(accessToken: string) {
    const response = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Kakao token verification failed');
    }

    const data = await response.json();
    return {
      providerId: String(data.id),
      email: data.kakao_account?.email,
      name: data.properties?.nickname,
    };
  }

  private async verifyGoogleToken(accessToken: string) {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!response.ok) {
      throw new Error('Google token verification failed');
    }

    const data = await response.json();
    return {
      providerId: data.sub,
      email: data.email,
      name: data.name,
    };
  }

  async exchangeCodeForToken(
    provider: string,
    code: string,
    redirectUri: string,
  ): Promise<string> {
    if (provider === 'kakao') {
      const clientId = process.env.KAKAO_CLIENT_ID;
      const clientSecret = process.env.KAKAO_CLIENT_SECRET;

      if (!clientId) {
        throw new Error('KAKAO_CLIENT_ID not configured');
      }

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code,
      });

      if (clientSecret) {
        params.append('client_secret', clientSecret);
      }

      const response = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.warn(
          `Kakao token exchange failed: ${JSON.stringify(data)}`,
        );
        throw new Error(
          `Kakao token exchange failed: ${data.error_description || data.error}`,
        );
      }

      return data.access_token;
    } else if (provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error(
          'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured',
        );
      }

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.warn(
          `Google token exchange failed: ${JSON.stringify(data)}`,
        );
        throw new Error(
          `Google token exchange failed: ${data.error_description || data.error}`,
        );
      }

      return data.access_token;
    }

    throw new Error(`Unknown provider: ${provider}`);
  }

  async processOAuthLogin(
    oauthUser: { providerId: string; email?: string; name?: string },
    provider: string,
  ) {
    if (!oauthUser.email) {
      throw new HttpException(
        '이메일 정보를 가져올 수 없습니다. 이메일 제공 동의가 필요합니다.',
        HttpStatus.BAD_REQUEST,
      );
    }

    let admin = await this.dbService.findAdminByProviderId(
      provider,
      oauthUser.providerId,
    );

    if (!admin) {
      admin = await this.dbService.findAdminByEmail(oauthUser.email);

      if (admin) {
        throw new HttpException(
          `이미 ${admin.provider}로 가입된 계정입니다.`,
          HttpStatus.CONFLICT,
        );
      }

      // 기본 organization: 담소 관제센터
      const DEFAULT_ORGANIZATION_ID = '583c02c7-5188-419f-90b9-edcad0f40ef4';

      const newAdmin = await this.dbService.createAdmin({
        email: oauthUser.email,
        name: oauthUser.name,
        provider,
        providerId: oauthUser.providerId,
        organizationId: DEFAULT_ORGANIZATION_ID,
      });

      admin = await this.dbService.findAdminById(newAdmin.id);
    }

    if (!admin!.is_active) {
      throw new HttpException(
        '계정이 비활성화되었습니다. 관리자에게 문의하세요.',
        HttpStatus.FORBIDDEN,
      );
    }

    const jwtPayload = {
      sub: admin!.id,
      email: admin!.email,
      role: admin!.role,
      type: 'admin',
    };

    const jwtAccessToken = this.authService.signAdminAccessToken(jwtPayload);
    const jwtRefreshToken = this.authService.signAdminRefreshToken(jwtPayload);

    const refreshTokenHash = this.authService.hashToken(jwtRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.dbService.createAdminRefreshToken(
      admin!.id,
      refreshTokenHash,
      expiresAt,
    );

    await this.dbService.updateAdminLastLogin(admin!.id);

    this.logger.log(
      `OAuth login success adminId=${admin!.id} role=${admin!.role}`,
    );

    return {
      accessToken: jwtAccessToken,
      refreshToken: jwtRefreshToken,
      admin: {
        id: admin!.id,
        email: admin!.email,
        name: admin!.name,
        role: admin!.role,
        organizationId: admin!.organization_id,
      },
    };
  }
}
