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
      matchStatus: 'matched';
      wardInfo?: {
        phoneNumber: string;
        linkedGuardian?: {
          id: string;
          nickname: string | null;
        };
        linkedOrganization?: {
          id: string;
          name: string;
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
      throw new Error(
        'API_JWT_SECRET or JWT_SECRET environment variable is required',
      );
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
    this.logger.log(
      `kakaoLogin kakaoId=${kakaoProfile.kakaoId} email=${kakaoProfile.email ?? 'none'}`,
    );

    // 2. 기존 사용자 확인
    const existingUser = await this.dbService.findUserByKakaoId(
      kakaoProfile.kakaoId,
    );

    if (existingUser) {
      // 기존 사용자인데 ward 타입이면 ward 정보가 실제로 있는지 확인
      if (existingUser.user_type === 'ward') {
        const ward = await this.dbService.findWardByUserId(existingUser.id);
        if (!ward) {
          // ward 정보가 없는 불완전한 사용자 - 삭제 후 재생성
          this.logger.warn(
            `Incomplete ward user found userId=${existingUser.id}, deleting and recreating`,
          );
          await this.dbService.deleteUser(existingUser.id);
          // 재생성 로직으로 진행
          if (params.userType === 'ward') {
            return this.handleWardRegistration(kakaoProfile);
          }
          // userType이 없으면 보호자로 처리
        }
      }

      // 기존 사용자 - JWT 발급
      this.logger.log(`kakaoLogin existing user id=${existingUser.id}`);
      const tokens = await this.issueTokens(
        existingUser.id,
        existingUser.user_type as UserType,
      );
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
      // 보호자 로그인 시도 - 해당 이메일이 이미 ward로 등록/예정인지 체크
      if (kakaoProfile.email) {
        // 3-1. users 테이블에서 이미 ward로 등록된 사용자인지 확인
        const existingWardUser = await this.dbService.findUserByEmail(
          kakaoProfile.email,
        );
        if (existingWardUser?.user_type === 'ward') {
          this.logger.warn(
            `Guardian login blocked - email already registered as ward: ${kakaoProfile.email}`,
          );
          throw new UnauthorizedException(
            '이 이메일은 이미 어르신으로 등록되어 있습니다. 어르신 버튼을 눌러 로그인해주세요.',
          );
        }

        // 3-2. organization_wards에 ward로 사전 등록된 이메일인지 확인
        const pendingOrgWard =
          await this.dbService.findPendingOrganizationWardByEmail(
            kakaoProfile.email,
          );
        if (pendingOrgWard) {
          this.logger.warn(
            `Guardian login blocked - email pre-registered as ward in organization: ${kakaoProfile.email}`,
          );
          throw new UnauthorizedException(
            '이 이메일은 기관에서 어르신으로 등록되어 있습니다. 어르신 버튼을 눌러 로그인해주세요.',
          );
        }

        // 3-3. guardians 테이블에서 다른 보호자가 등록한 어르신 이메일인지 확인
        const existingGuardianForEmail =
          await this.dbService.findGuardianByWardEmail(kakaoProfile.email);
        if (existingGuardianForEmail) {
          this.logger.warn(
            `Guardian login blocked - email registered as ward by another guardian: ${kakaoProfile.email}`,
          );
          throw new UnauthorizedException(
            '이 이메일은 이미 어르신으로 등록되어 있습니다. 어르신 버튼을 눌러 로그인해주세요.',
          );
        }
      }

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
    const httpsProfileImage =
      profileImage?.replace(/^http:\/\//i, 'https://') ?? null;
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
    // 1. 어르신의 이메일로 보호자 매칭 시도
    const matchedGuardian = kakaoProfile.email
      ? await this.dbService.findGuardianByWardEmail(kakaoProfile.email)
      : undefined;

    // 2. 어르신의 이메일로 기관 피보호자 매칭 시도
    const matchedOrganizationWard = kakaoProfile.email
      ? await this.dbService.findPendingOrganizationWardByEmail(
          kakaoProfile.email,
        )
      : undefined;

    // 3. 보호자도 기관도 없으면 가입 차단
    if (!matchedGuardian && !matchedOrganizationWard) {
      this.logger.warn(
        `Ward registration blocked - no guardian or organization found for email=${kakaoProfile.email}`,
      );
      throw new UnauthorizedException(
        '등록된 보호자 또는 기관이 없습니다. 보호자에게 먼저 등록을 요청해주세요.',
      );
    }

    // 4. 사용자 생성
    const user = await this.dbService.createUserWithKakao({
      kakaoId: kakaoProfile.kakaoId,
      email: kakaoProfile.email,
      nickname: kakaoProfile.nickname,
      profileImageUrl: kakaoProfile.profileImageUrl,
      userType: 'ward',
    });

    // 5. 어르신 정보 생성 (기관 또는 보호자가 등록한 전화번호 사용)
    const phoneNumber =
      matchedOrganizationWard?.phone_number ??
      matchedGuardian?.ward_phone_number ??
      '';
    const ward = await this.dbService.createWard({
      userId: user.id,
      phoneNumber,
      guardianId: matchedGuardian?.id ?? null,
    });

    // 6. 기관 피보호자 자동 연동 처리
    let linkedOrganization: { id: string; name: string } | undefined;
    if (matchedOrganizationWard) {
      try {
        // organizationWard 연동 (isRegistered=true, wardId 설정)
        await this.dbService.linkOrganizationWard({
          organizationWardId: matchedOrganizationWard.id,
          wardId: ward.id,
        });
        // ward에 organizationId 설정
        await this.dbService.updateWardOrganization({
          wardId: ward.id,
          organizationId: matchedOrganizationWard.organization_id,
        });

        // 기관 정보 조회
        const organization = await this.dbService.findOrganizationById(
          matchedOrganizationWard.organization_id,
        );
        if (organization) {
          linkedOrganization = {
            id: organization.id,
            name: organization.name,
          };
        }

        this.logger.log(
          `Auto-linked ward=${ward.id} to organization=${matchedOrganizationWard.organization_id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to auto-link organization ward: ${(error as Error).message}`,
        );
        // 연동 실패 시 DB 롤백
        await this.dbService.deleteUser(user.id);
        throw new Error('기관 연동에 실패했습니다. 다시 시도해주세요.');
      }
    }

    const tokens = await this.issueTokens(user.id, 'ward');

    // 7. 개인 보호자 매칭 정보 조회
    let linkedGuardian: { id: string; nickname: string | null } | undefined;
    if (matchedGuardian) {
      const guardianUser = await this.dbService.findUserById(
        matchedGuardian.user_id,
      );
      if (guardianUser) {
        linkedGuardian = {
          id: guardianUser.id,
          nickname: guardianUser.nickname,
        };
      }
    }

    this.logger.log(
      `Ward registration success userId=${user.id} guardian=${!!matchedGuardian} organization=${!!matchedOrganizationWard}`,
    );

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
        linkedGuardian,
        linkedOrganization,
      },
    };
  }

  private async issueTokens(
    userId: string,
    userType: UserType | null,
  ): Promise<AuthTokens> {
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

    this.logger.log(
      `registerGuardian userId=${user.id} guardianId=${guardian.id}`,
    );
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
    return jwt.sign({ ...payload, tokenType: 'admin_access' }, this.jwtSecret, {
      expiresIn: '1h',
    });
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
