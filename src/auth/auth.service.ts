import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import { DbService } from '../database';

type UserType = 'guardian' | 'ward';

// API Token types (for anonymous/legacy auth)
export type ApiTokenResult = {
  accessToken: string;
  expiresAt: string;
  user: {
    id: string;
    identity: string;
    displayName: string;
  };
};

export type ApiAuthContext = {
  identity?: string;
  displayName?: string;
  userId?: string;
  sub?: string;
};

type KakaoProfile = {
  kakaoId: string;
  email: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
};

type TokenPayload = {
  sub: string;
  type: 'access' | 'refresh' | 'temp';
  userType?: UserType;
  kakaoId?: string;
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type UserInfo = {
  id: string;
  email: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  userType: UserType | null;
};

type KakaoLoginResult =
  | {
      isNewUser: false;
      accessToken: string;
      refreshToken: string;
      user: UserInfo;
    }
  | {
      // 보호자 신규 가입 - 추가 정보 필요
      isNewUser: true;
      requiresRegistration: true;
      accessToken: string;
      refreshToken: string;
      user: UserInfo;
    }
  | {
      // 어르신 신규 가입 - 자동 매칭 시도
      isNewUser: true;
      requiresRegistration: false;
      accessToken: string;
      refreshToken: string;
      user: UserInfo;
      matchStatus: 'matched' | 'not_matched';
      wardInfo?: {
        phoneNumber: string;
        linkedGuardian?: {
          id: string;
          nickname: string | null;
        };
      };
    };

type GuardianRegistrationResult = {
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
  guardianInfo: {
    id: string;
    wardEmail: string;
    wardPhoneNumber: string;
    linkedWard: null;
  };
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret: string;
  private readonly accessTokenExpiry: number;
  private readonly refreshTokenExpiry: number;

  constructor(private readonly dbService: DbService) {
    const secret = process.env.API_JWT_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('API_JWT_SECRET or JWT_SECRET environment variable is required');
    }
    this.jwtSecret = secret;
    this.accessTokenExpiry = 60 * 60; // 1 hour
    this.refreshTokenExpiry = 14 * 24 * 60 * 60; // 2 weeks
  }

  async kakaoLogin(params: {
    kakaoAccessToken: string;
    userType?: UserType;
  }): Promise<KakaoLoginResult> {
    // 1. 카카오 토큰 검증
    const kakaoProfile = await this.verifyKakaoToken(params.kakaoAccessToken);
    this.logger.log(`kakaoLogin kakaoId=${kakaoProfile.kakaoId} email=${kakaoProfile.email ?? 'none'}`);

    // 2. 기존 사용자 확인
    const existingUser = await this.dbService.findUserByKakaoId(kakaoProfile.kakaoId);

    if (existingUser) {
      // 기존 사용자 - JWT 발급
      this.logger.log(`kakaoLogin existing user id=${existingUser.id}`);
      const tokens = await this.issueTokens(existingUser.id, existingUser.user_type as UserType);
      return {
        isNewUser: false,
        ...tokens,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          nickname: existingUser.nickname,
          profileImageUrl: existingUser.profile_image_url,
          userType: existingUser.user_type as UserType | null,
        },
      };
    }

    // 3. 신규 사용자
    if (params.userType === 'ward') {
      // 어르신 - 자동 매칭 시도
      return this.handleWardRegistration(kakaoProfile);
    } else {
      // 보호자 - 사용자 먼저 생성 (user_type은 null로, 추가 정보 입력 후 guardian으로 변경)
      const user = await this.dbService.createUserWithKakao({
        kakaoId: kakaoProfile.kakaoId,
        email: kakaoProfile.email,
        nickname: kakaoProfile.nickname,
        profileImageUrl: kakaoProfile.profileImageUrl,
        userType: null, // 추가 정보 입력 전까지 null
      });

      const tokens = await this.issueTokens(user.id, null);
      this.logger.log(`kakaoLogin new guardian (pending) userId=${user.id}`);

      return {
        isNewUser: true,
        requiresRegistration: true,
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          nickname: user.nickname,
          profileImageUrl: user.profile_image_url,
          userType: null,
        },
      };
    }
  }

  private async verifyKakaoToken(accessToken: string): Promise<KakaoProfile> {
    const response = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      this.logger.warn(`verifyKakaoToken failed status=${response.status}`);
      throw new UnauthorizedException('Invalid Kakao access token');
    }

    const data = await response.json();
    // 카카오 프로필 이미지 URL을 HTTPS로 변환 (Mixed Content 방지)
    const profileImage = data.properties?.profile_image ?? null;
    const httpsProfileImage = profileImage?.replace(/^http:\/\//i, 'https://') ?? null;
    return {
      kakaoId: String(data.id),
      email: data.kakao_account?.email ?? null,
      nickname: data.properties?.nickname ?? null,
      profileImageUrl: httpsProfileImage,
    };
  }

  private async handleWardRegistration(
    kakaoProfile: KakaoProfile,
  ): Promise<KakaoLoginResult> {
    // 어르신의 이메일로 보호자 매칭 시도
    const matchedGuardian = kakaoProfile.email
      ? await this.dbService.findGuardianByWardEmail(kakaoProfile.email)
      : undefined;

    // 사용자 생성
    const user = await this.dbService.createUserWithKakao({
      kakaoId: kakaoProfile.kakaoId,
      email: kakaoProfile.email,
      nickname: kakaoProfile.nickname,
      profileImageUrl: kakaoProfile.profileImageUrl,
      userType: 'ward',
    });

    // 어르신 정보 생성
    const ward = await this.dbService.createWard({
      userId: user.id,
      phoneNumber: '', // 이후 설정에서 입력
      guardianId: matchedGuardian?.id ?? null,
    });

    const tokens = await this.issueTokens(user.id, 'ward');

    if (matchedGuardian) {
      this.logger.log(`handleWardRegistration matched userId=${user.id} guardianId=${matchedGuardian.id}`);
      const guardianUser = await this.dbService.findUserById(matchedGuardian.user_id);
      return {
        isNewUser: true,
        requiresRegistration: false,
        ...tokens,
        user: {
          id: user.id,
          email: user.email,
          nickname: user.nickname,
          profileImageUrl: user.profile_image_url,
          userType: 'ward',
        },
        matchStatus: 'matched',
        wardInfo: {
          phoneNumber: ward.phone_number,
          linkedGuardian: guardianUser
            ? {
                id: guardianUser.id,
                nickname: guardianUser.nickname,
              }
            : undefined,
        },
      };
    }

    this.logger.log(`handleWardRegistration not matched userId=${user.id}`);
    return {
      isNewUser: true,
      requiresRegistration: false,
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        profileImageUrl: user.profile_image_url,
        userType: 'ward',
      },
      matchStatus: 'not_matched',
      wardInfo: {
        phoneNumber: ward.phone_number,
      },
    };
  }

  private async issueTokens(userId: string, userType: UserType | null): Promise<AuthTokens> {
    const accessPayload: TokenPayload = {
      sub: userId,
      type: 'access',
      userType: userType ?? undefined,
    };

    const refreshPayload: TokenPayload = {
      sub: userId,
      type: 'refresh',
    };

    const accessToken = jwt.sign(accessPayload, this.jwtSecret, {
      expiresIn: this.accessTokenExpiry,
    });

    const refreshToken = jwt.sign(refreshPayload, this.jwtSecret, {
      expiresIn: this.refreshTokenExpiry,
    });

    // Refresh token을 DB에 저장
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.refreshTokenExpiry * 1000);
    await this.dbService.saveRefreshToken({
      userId,
      tokenHash,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  verifyAccessToken(token: string): TokenPayload | null {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as TokenPayload;
      if (payload.type !== 'access') return null;
      return payload;
    } catch {
      return null;
    }
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    // 1. Refresh Token JWT 검증
    let payload: TokenPayload;
    try {
      payload = jwt.verify(refreshToken, this.jwtSecret) as TokenPayload;
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // 2. DB에서 토큰 확인
    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await this.dbService.findRefreshToken(tokenHash);
    if (!storedToken) {
      this.logger.warn(`refreshTokens token not found userId=${payload.sub}`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // 3. 사용자 확인
    const user = await this.dbService.findUserById(payload.sub);
    if (!user) {
      this.logger.warn(`refreshTokens user not found userId=${payload.sub}`);
      throw new UnauthorizedException('User not found');
    }

    // 4. 기존 토큰 무효화 (Token Rotation)
    await this.dbService.deleteRefreshToken(tokenHash);

    // 5. 새 토큰 발급
    this.logger.log(`refreshTokens userId=${user.id}`);
    return this.issueTokens(user.id, user.user_type as UserType | null);
  }

  async registerGuardian(params: {
    accessToken: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }): Promise<GuardianRegistrationResult> {
    // 1. Access Token 검증
    const payload = this.verifyAccessToken(params.accessToken);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // 2. 사용자 조회
    const user = await this.dbService.findUserById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // 3. 이미 등록 완료된 사용자인지 확인
    if (user.user_type === 'guardian') {
      throw new UnauthorizedException('User already registered as guardian');
    }

    // 4. user_type을 guardian으로 업데이트
    await this.dbService.updateUserType(user.id, 'guardian');

    // 5. 보호자 정보 생성
    const guardian = await this.dbService.createGuardian({
      userId: user.id,
      wardEmail: params.wardEmail,
      wardPhoneNumber: params.wardPhoneNumber,
    });

    // 6. 새 JWT 발급 (user_type이 변경되었으므로)
    const tokens = await this.issueTokens(user.id, 'guardian');

    this.logger.log(`registerGuardian userId=${user.id} guardianId=${guardian.id}`);
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        profileImageUrl: user.profile_image_url,
        userType: 'guardian',
      },
      guardianInfo: {
        id: guardian.id,
        wardEmail: guardian.ward_email,
        wardPhoneNumber: guardian.ward_phone_number,
        linkedWard: null,
      },
    };
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [관리자 JWT] - Issue #18
  // ─────────────────────────────────────────────────────────────────────────

  signAdminAccessToken(payload: {
    sub: string;
    email: string;
    role: string;
    type: string;
  }): string {
    return jwt.sign(
      { ...payload, tokenType: 'admin_access' },
      this.jwtSecret,
      { expiresIn: '1h' },
    );
  }

  signAdminRefreshToken(payload: {
    sub: string;
    email: string;
    role: string;
    type: string;
  }): string {
    return jwt.sign(
      { ...payload, tokenType: 'admin_refresh' },
      this.jwtSecret,
      { expiresIn: '30d' },
    );
  }

  verifyAdminAccessToken(token: string): {
    sub: string;
    email: string;
    role: string;
    type: string;
  } {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as {
        sub: string;
        email: string;
        role: string;
        type: string;
        tokenType: string;
      };

      if (payload.tokenType !== 'admin_access') {
        throw new UnauthorizedException('Invalid admin access token');
      }

      return {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        type: payload.type,
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired admin access token');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // [API 토큰] - 익명/레거시 인증용
  // ─────────────────────────────────────────────────────────────────────────

  private readonly apiJwtTtlSeconds = 60 * 60 * 24; // 24 hours

  issueApiToken(identity: string, displayName: string): ApiTokenResult {
    const userId = randomUUID();
    const token = jwt.sign(
      { sub: userId, identity, displayName },
      this.jwtSecret,
      { expiresIn: this.apiJwtTtlSeconds },
    );
    const expiresAt = new Date(
      Date.now() + this.apiJwtTtlSeconds * 1000,
    ).toISOString();

    return {
      accessToken: token,
      expiresAt,
      user: {
        id: userId,
        identity,
        displayName,
      },
    };
  }

  verifyApiToken(token: string): ApiAuthContext {
    const payload = jwt.verify(token, this.jwtSecret) as ApiAuthContext;
    if (!payload.userId && payload.sub) {
      payload.userId = payload.sub;
    }
    return payload;
  }

  getAuthContext(authorization?: string): ApiAuthContext | null {
    if (!authorization) return null;
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!token) return null;
    try {
      return this.verifyApiToken(token);
    } catch {
      return null;
    }
  }
}
