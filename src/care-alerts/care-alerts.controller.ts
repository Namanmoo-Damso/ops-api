import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { CareAlertsService } from './care-alerts.service';
import { AuthService } from '../auth';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCareAlertDto } from './dto/create-care-alert.dto';

type UserType = 'guardian' | 'ward';

/** Internal token payload */
type InternalAuthPayload = {
  sub: 'internal';
  role: 'internal';
};

/** User token payload from AuthService.verifyAccessToken */
type UserAuthPayload = {
  sub: string;
  type: 'access' | 'refresh' | 'temp';
  userType?: UserType;
  kakaoId?: string;
};

type AuthPayload = InternalAuthPayload | UserAuthPayload;

@Controller('v1')
export class CareAlertsController {
  private readonly logger = new Logger(CareAlertsController.name);

  constructor(
    private readonly careAlertsService: CareAlertsService,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) { }

  private verifyAuthHeader(authorization: string | undefined): AuthPayload {
    const authHeader = authorization ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;

    if (!token) {
      throw new HttpException(
        'Access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Agent 등 내부 서비스 호출을 위한 Internal Token 확인
    if (
      process.env.API_INTERNAL_TOKEN &&
      token === process.env.API_INTERNAL_TOKEN
    ) {
      return { sub: 'internal', role: 'internal' };
    }

    const payload = this.authService.verifyAccessToken(token);
    if (!payload) {
      throw new HttpException(
        'Invalid or expired access token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return payload;
  }

  /**
   * Ward용 - 케어 알림 수신
   * POST /v1/care-alerts
   */
  @Post('care-alerts')
  async createAlert(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-ward-id') xWardId: string | undefined,
    @Body() dto: CreateCareAlertDto,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    // Internal 요청인 경우 (Agent)
    if ('role' in payload && payload.role === 'internal') {
      if (!xWardId) {
        throw new HttpException(
          'X-Ward-Id header is required for internal requests',
          HttpStatus.BAD_REQUEST,
        );
      }
      this.logger.log(
        `[API] POST /v1/care-alerts (Internal) wardId=${xWardId} alertType=${dto.alertType}`,
      );
      return await this.careAlertsService.processAlert(xWardId, dto);
    }

    this.logger.log(
      `[API] POST /v1/care-alerts userId=${payload.sub} alertType=${dto.alertType}`,
    );

    try {
      // userId로 wardId 조회
      const ward = await this.prisma.ward.findUnique({
        where: { userId: payload.sub },
      });

      if (!ward) {
        this.logger.warn(
          `[API] care-alerts ward not found for userId=${payload.sub}`,
        );
        throw new HttpException('Ward not found', HttpStatus.NOT_FOUND);
      }

      return await this.careAlertsService.processAlert(ward.id, dto);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] care-alerts error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to process care alert',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Guardian용 - 알림 목록 조회
   * GET /v1/guardians/wards/:wardId/alerts
   */
  @Get('guardians/wards/:wardId/alerts')
  async getAlerts(
    @Headers('authorization') authorization: string | undefined,
    @Param('wardId') wardId: string,
    @Query('type') type?: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    this.logger.log(
      `[API] GET /v1/guardians/wards/${wardId}/alerts userId=${payload.sub} type=${type ?? 'all'}`,
    );

    try {
      // Guardian 권한 확인
      await this.verifyGuardianAccess(payload.sub, wardId);

      return await this.careAlertsService.getAlerts(wardId, {
        type,
        since,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] getAlerts error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to get alerts',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Guardian용 - 감정 리포트 조회
   * GET /v1/guardians/wards/:wardId/emotion-report
   */
  @Get('guardians/wards/:wardId/emotion-report')
  async getEmotionReport(
    @Headers('authorization') authorization: string | undefined,
    @Param('wardId') wardId: string,
    @Query('date') date?: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    const targetDate = date ?? new Date().toISOString().split('T')[0];

    this.logger.log(
      `[API] GET /v1/guardians/wards/${wardId}/emotion-report userId=${payload.sub} date=${targetDate}`,
    );

    try {
      // Guardian 권한 확인
      await this.verifyGuardianAccess(payload.sub, wardId);

      return await this.careAlertsService.getEmotionReport(wardId, targetDate);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] getEmotionReport error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to get emotion report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Guardian용 - 알림 확인 처리
   * PATCH /v1/guardians/alerts/:alertId/acknowledge
   */
  @Patch('guardians/alerts/:alertId/acknowledge')
  async acknowledgeAlert(
    @Headers('authorization') authorization: string | undefined,
    @Param('alertId') alertId: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    this.logger.log(
      `[API] PATCH /v1/guardians/alerts/${alertId}/acknowledge userId=${payload.sub}`,
    );

    try {
      // Alert의 ward가 Guardian에게 연결되어 있는지 확인
      const alert = await this.prisma.careAlertEvent.findUnique({
        where: { id: alertId },
        include: {
          ward: {
            include: {
              guardian: true,
            },
          },
        },
      });

      if (!alert) {
        throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
      }

      // Guardian 권한 확인
      const guardian = await this.prisma.guardian.findUnique({
        where: { userId: payload.sub },
      });

      if (!guardian || alert.ward.guardianId !== guardian.id) {
        throw new HttpException(
          'Not authorized to acknowledge this alert',
          HttpStatus.FORBIDDEN,
        );
      }

      return await this.careAlertsService.acknowledgeAlert(alertId, payload.sub);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] acknowledgeAlert error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to acknowledge alert',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 디버깅용 - Emotion 버퍼 상태 조회
   * GET /v1/care-alerts/buffer-status
   */
  @Get('care-alerts/buffer-status')
  async getBufferStatus(
    @Headers('authorization') authorization: string | undefined,
    @Query('wardId') wardId?: string,
  ) {
    this.verifyAuthHeader(authorization);

    this.logger.log(
      `[API] GET /v1/care-alerts/buffer-status wardId=${wardId ?? 'all'}`,
    );

    return {
      buffers: this.careAlertsService.getBufferStatus(wardId),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Guardian의 Ward 접근 권한 확인
   */
  private async verifyGuardianAccess(
    userId: string,
    wardId: string,
  ): Promise<void> {
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId },
    });

    if (!guardian) {
      throw new HttpException('Guardian not found', HttpStatus.FORBIDDEN);
    }

    // Ward가 Guardian에게 연결되어 있는지 확인
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
    });

    if (!ward) {
      throw new HttpException('Ward not found', HttpStatus.NOT_FOUND);
    }

    if (ward.guardianId !== guardian.id) {
      // GuardianWardRegistration을 통한 연결 확인
      const registration = await this.prisma.guardianWardRegistration.findFirst({
        where: {
          guardianId: guardian.id,
          linkedWardId: wardId,
        },
      });

      if (!registration) {
        throw new HttpException(
          'Not authorized to access this ward',
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }
}
