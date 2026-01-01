import {
  Controller,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LiveKitService } from '../integration/livekit';
import {
  KakaoLoginDto,
  RefreshTokenDto,
  AnonymousAuthDto,
} from './dto';
import { DbService } from '../database';
import { EventsService } from '../events';

@Controller('v1/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly livekitService: LiveKitService,
    private readonly dbService: DbService,
    private readonly eventsService: EventsService,
  ) {}

  @Post('kakao')
  async kakaoLogin(@Body() body: KakaoLoginDto) {
    const kakaoAccessToken = body.kakaoAccessToken?.trim();
    if (!kakaoAccessToken) {
      throw new HttpException(
        'kakaoAccessToken is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      this.logger.log(`kakaoLogin userType=${body.userType ?? 'none'}`);
      const result = await this.authService.kakaoLogin({
        kakaoAccessToken,
        userType: body.userType,
      });
      return result;
    } catch (error) {
      if ((error as HttpException).getStatus?.() === HttpStatus.UNAUTHORIZED) {
        throw error;
      }
      this.logger.warn(`kakaoLogin failed error=${(error as Error).message}`);
      throw new HttpException(
        (error as Error).message || 'Authentication failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('refresh')
  async refreshTokens(@Body() body: RefreshTokenDto) {
    const refreshToken = body.refreshToken?.trim();
    if (!refreshToken) {
      throw new HttpException(
        'refreshToken is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      this.logger.log('refreshTokens');
      const tokens = await this.authService.refreshTokens(refreshToken);
      return tokens;
    } catch (error) {
      if ((error as HttpException).getStatus?.() === HttpStatus.UNAUTHORIZED) {
        throw error;
      }
      this.logger.warn(`refreshTokens failed error=${(error as Error).message}`);
      throw new HttpException(
        (error as Error).message || 'Token refresh failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Post('anonymous')
  anonymousAuth(@Body() body: AnonymousAuthDto) {
    const identity = body.identity?.trim() || `user-${Date.now()}`;
    const displayName = body.displayName?.trim() || identity;
    return this.authService.issueApiToken(identity, displayName);
  }

  @Post('logout')
  async logout(
    @Headers('authorization') authorization: string | undefined,
  ) {
    const payload = this.authService.verifyAccessToken(
      authorization?.replace(/^Bearer\s+/i, '') ?? '',
    );
    if (!payload) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const userId = payload.sub;
    this.logger.log(`logout userId=${userId}`);

    try {
      // 0. Get user identity for LiveKit
      const user = await this.dbService.findUserById(userId);
      const identity = user?.identity;

      // 1. LiveKit에서 강제 퇴장 (관제 페이지 목록에서 즉시 제거)
      if (identity) {
        await this.livekitService.removeParticipantFromAllRooms(identity);

        // SSE 이벤트 발행 (프론트엔드에서 목록 삭제)
        this.eventsService.emit({
          type: 'user-logout',
          identity,
          userId,
        });
      }

      // 2. Delete room members (모니터링 목록에서 제거)
      await this.dbService.deleteRoomMembersByUserId(userId);

      // 3. Delete devices (푸시 토큰 제거)
      await this.dbService.deleteDevicesByUserId(userId);

      // 4. Delete refresh tokens
      await this.dbService.deleteUserRefreshTokens(userId);

      return {
        success: true,
        message: '로그아웃이 완료되었습니다.',
      };
    } catch (error) {
      this.logger.error(`logout failed userId=${userId} error=${(error as Error).message}`);
      throw new HttpException(
        'Logout failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
