import { Body, Controller, Get, Headers, Post, Logger } from '@nestjs/common';
import { DbService } from './database';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly dbService: DbService) {}

  @Get('/healthz')
  getHealth() {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  /**
   * POST /webhook/kakao/unlink
   * 카카오 연결 해제 웹훅 (연동해제/카카오계정 탈퇴)
   *
   * 카카오 웹훅 스펙:
   * - Content-Type: application/x-www-form-urlencoded
   * - Header: Authorization: KakaoAK ${ADMIN_KEY}
   * - Body: app_id, user_id, referrer_type
   * - 3초 내 무조건 200 응답 필수
   */
  @Post('/webhook/kakao/unlink')
  async kakaoUnlink(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { app_id?: string; user_id?: string; referrer_type?: string },
  ) {
    const appId = body.app_id?.toString().trim();
    const kakaoId = body.user_id?.toString().trim();
    const referrerType = body.referrer_type ?? 'unknown';

    this.logger.log(
      `kakaoUnlink received appId=${appId} kakaoId=${kakaoId} type=${referrerType}`,
    );

    if (!kakaoId) {
      this.logger.warn('kakaoUnlink missing user_id');
      return { success: true };
    }

    // 비동기로 처리하되 3초 이내 응답 보장
    setImmediate(async () => {
      try {
        const user = await this.dbService.findUserByKakaoId(kakaoId);
        if (!user) {
          this.logger.log(`kakaoUnlink user not found kakaoId=${kakaoId}`);
          return;
        }

        await this.dbService.deleteUser(user.id);
        this.logger.log(
          `kakaoUnlink deleted userId=${user.id} kakaoId=${kakaoId}`,
        );
      } catch (error) {
        this.logger.error(
          `kakaoUnlink failed kakaoId=${kakaoId} error=${(error as Error).message}`,
        );
      }
    });

    return { success: true };
  }
}
