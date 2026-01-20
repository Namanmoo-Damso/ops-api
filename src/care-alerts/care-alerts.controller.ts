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
import { EventsService } from '../events/events.service';
import { LiveKitService } from '../integration/livekit/livekit.service';
import { CreateCareAlertDto } from './dto/create-care-alert.dto';

type UserType = 'guardian' | 'ward';

/** Internal token payload */
type InternalAuthPayload = {
  sub: 'internal';
  role: 'internal';
};

/** Admin token payload (Web admin panel) */
type AdminAuthPayload = {
  sub: string;
  role: 'admin';
};

/** User token payload from AuthService.verifyAccessToken */
type UserAuthPayload = {
  sub: string;
  type: 'access' | 'refresh' | 'temp';
  userType?: UserType;
  kakaoId?: string;
};

type AuthPayload = InternalAuthPayload | AdminAuthPayload | UserAuthPayload;

@Controller('v1')
export class CareAlertsController {
  private readonly logger = new Logger(CareAlertsController.name);

  constructor(
    private readonly careAlertsService: CareAlertsService,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly livekitService: LiveKitService,
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

    // 1. Guardian/User 토큰 확인
    const payload = this.authService.verifyAccessToken(token);
    if (payload) {
      return payload;
    }

    // 2. Admin 토큰 확인 (Web 어드민 패널용)
    try {
      const adminPayload = this.authService.verifyAdminAccessToken(token);
      if (adminPayload) {
        return { sub: adminPayload.sub, role: 'admin' };
      }
    } catch {
      // Admin token verification failed
    }

    throw new HttpException(
      'Invalid or expired access token',
      HttpStatus.UNAUTHORIZED,
    );
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
   * Guardian/Ward용 - 알림 확인 처리
   * PATCH /v1/guardians/alerts/:alertId/acknowledge
   * 
   * Guardian: 자신에게 연결된 Ward의 알림 해제 가능
   * Ward: 자신의 알림만 해제 가능
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
      // Alert 조회 (ward, guardian, organization 포함)
      const alert = await this.prisma.careAlertEvent.findUnique({
        where: { id: alertId },
        include: {
          ward: {
            include: {
              guardian: true,
              organization: true,
            },
          },
        },
      });

      if (!alert) {
        throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
      }

      // Internal 요청인 경우 (Agent) - 권한 확인 스킵
      const isInternal = 'role' in payload && payload.role === 'internal';
      if (isInternal) {
        this.logger.log(
          `[API] acknowledgeAlert authorized as Internal (Agent)`,
        );
      }

      // 권한 확인: Guardian 또는 Ward 본인
      let isAuthorized = isInternal;

      // 1. Ward 본인인지 확인
      if (!isAuthorized) {
        const ward = await this.prisma.ward.findUnique({
          where: { userId: payload.sub },
        });
        if (ward && ward.id === alert.wardId) {
          isAuthorized = true;
          this.logger.log(
            `[API] acknowledgeAlert authorized as Ward: wardId=${ward.id}`,
          );
        }
      }

      // 2. Guardian인지 확인
      if (!isAuthorized) {
        const guardian = await this.prisma.guardian.findUnique({
          where: { userId: payload.sub },
        });
        if (guardian && alert.ward.guardianId === guardian.id) {
          isAuthorized = true;
          this.logger.log(
            `[API] acknowledgeAlert authorized as Guardian: guardianId=${guardian.id}`,
          );
        }
      }

      if (!isAuthorized) {
        throw new HttpException(
          'Not authorized to acknowledge this alert',
          HttpStatus.FORBIDDEN,
        );
      }

      // 알림 해제 처리 (서비스에서 남은 alert 확인)
      const result = await this.careAlertsService.acknowledgeAlert(alertId, payload.sub);

      // WebSocket으로 room-danger 이벤트 전송 + LiveKit room metadata 업데이트
      if (alert.roomName && alert.ward.organization) {
        if (result.roomMetadataAction === 'clear') {
          // 남은 alert이 없으면 isDanger: false
          this.logger.log(
            `[API] Emitting room-danger=false for roomName=${alert.roomName}`,
          );

          try {
            await this.livekitService.updateRoomMetadata(
              alert.roomName,
              JSON.stringify({
                isDanger: false,
                dangerCode: '0000',
                timestamp: Date.now(),
              }),
            );
            this.logger.log(
              `[API] Updated room metadata: room=${alert.roomName} isDanger=false`,
            );
          } catch (err) {
            this.logger.warn(
              `[API] Failed to update room metadata: ${(err as Error).message}`,
            );
          }

          this.eventsService.emit({
            type: 'room-danger',
            roomName: alert.roomName,
            isDanger: false,
            name: `acknowledge:${alertId}`,
          });
        } else if (result.roomMetadataAction === 'update' && result.highestRiskLevel) {
          // 남은 alert이 있으면 가장 높은 riskLevel로 유지
          this.logger.log(
            `[API] Updating room metadata with remaining alert riskLevel=${result.highestRiskLevel} for roomName=${alert.roomName}`,
          );

          try {
            await this.livekitService.updateRoomMetadata(
              alert.roomName,
              JSON.stringify({
                isDanger: true,
                riskLevel: result.highestRiskLevel,
                dangerCode: '0000', // 단일 alert이 아니므로 dangerCode는 reset
                timestamp: Date.now(),
              }),
            );
            this.logger.log(
              `[API] Updated room metadata: room=${alert.roomName} riskLevel=${result.highestRiskLevel}`,
            );
          } catch (err) {
            this.logger.warn(
              `[API] Failed to update room metadata: ${(err as Error).message}`,
            );
          }

          this.eventsService.emit({
            type: 'room-danger',
            roomName: alert.roomName,
            isDanger: true,
            riskLevel: result.highestRiskLevel,
            name: `acknowledge:${alertId}:remaining`,
          });
        }
      }

      return {
        success: result.success,
        alertId: result.alertId,
        acknowledgedAt: result.acknowledgedAt,
      };
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
   * Guardian용 - 센서 타입별 해제 API
   * PATCH /v1/guardians/alerts/acknowledge-by-type
   * 해당 roomName의 특정 sensorType alert만 해제
   */
  @Patch('guardians/alerts/acknowledge-by-type')
  async acknowledgeAlertByType(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { roomName: string; sensorType: string },
  ) {
    const payload = this.verifyAuthHeader(authorization);
    const { roomName, sensorType } = body;

    if (!roomName || !sensorType) {
      throw new HttpException(
        'roomName and sensorType are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `[API] PATCH /v1/guardians/alerts/acknowledge-by-type userId=${payload.sub} roomName=${roomName} sensorType=${sensorType}`,
    );

    try {
      // roomName으로 Ward 찾기 (권한 확인용)
      const alert = await this.prisma.careAlertEvent.findFirst({
        where: { roomName },
        include: {
          ward: {
            include: {
              guardian: true,
              organization: true,
            },
          },
        },
      });

      // alert이 없어도 센서 상태 해제는 허용 (UI 일관성)
      if (!alert) {
        this.logger.log(
          `[API] No alerts found for roomName=${roomName}, allowing sensor unlock`,
        );
        return {
          success: true,
          acknowledgedCount: 0,
        };
      }

      // Internal/Admin 요청인 경우 - 권한 확인 스킵
      const isInternal = 'role' in payload && payload.role === 'internal';
      const isAdmin = 'role' in payload && payload.role === 'admin';

      // 권한 확인
      let isAuthorized = isInternal || isAdmin;

      if (!isAuthorized) {
        const guardian = await this.prisma.guardian.findUnique({
          where: { userId: payload.sub },
        });
        if (guardian && alert.ward.guardianId === guardian.id) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        throw new HttpException(
          'Not authorized to acknowledge alerts for this room',
          HttpStatus.FORBIDDEN,
        );
      }

      // 센서 타입별 해제 처리
      const result = await this.careAlertsService.acknowledgeAlertByType(
        roomName,
        sensorType,
        payload.sub,
      );

      // LiveKit room metadata 업데이트
      if (alert.ward.organization) {
        if (result.roomMetadataAction === 'clear') {
          this.logger.log(
            `[API] Emitting room-danger=false for roomName=${roomName} (acknowledge-by-type)`,
          );

          try {
            await this.livekitService.updateRoomMetadata(
              roomName,
              JSON.stringify({
                isDanger: false,
                dangerCode: '0000',
                timestamp: Date.now(),
              }),
            );
          } catch (err) {
            this.logger.warn(
              `[API] Failed to update room metadata: ${(err as Error).message}`,
            );
          }

          this.eventsService.emit({
            type: 'room-danger',
            roomName,
            isDanger: false,
            name: `acknowledge-by-type:${roomName}:${sensorType}`,
          });
        } else if (result.roomMetadataAction === 'update' && result.highestRiskLevel) {
          this.logger.log(
            `[API] Updating room metadata with remaining alert riskLevel=${result.highestRiskLevel} for roomName=${roomName}`,
          );

          try {
            await this.livekitService.updateRoomMetadata(
              roomName,
              JSON.stringify({
                isDanger: true,
                riskLevel: result.highestRiskLevel,
                dangerCode: '0000',
                timestamp: Date.now(),
              }),
            );
          } catch (err) {
            this.logger.warn(
              `[API] Failed to update room metadata: ${(err as Error).message}`,
            );
          }

          this.eventsService.emit({
            type: 'room-danger',
            roomName,
            isDanger: true,
            riskLevel: result.highestRiskLevel,
            name: `acknowledge-by-type:${roomName}:${sensorType}:remaining`,
          });
        }
      }

      return {
        success: result.success,
        acknowledgedCount: result.acknowledgedCount,
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] acknowledgeAlertByType error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to acknowledge alerts by type',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Guardian용 - 전체 해제 API
   * PATCH /v1/guardians/alerts/acknowledge-all
   * 해당 roomName의 모든 미해제 alert을 일괄 해제
   */
  @Patch('guardians/alerts/acknowledge-all')
  async acknowledgeAllAlerts(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { roomName: string },
  ) {
    const payload = this.verifyAuthHeader(authorization);
    const { roomName } = body;

    if (!roomName) {
      throw new HttpException(
        'roomName is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `[API] PATCH /v1/guardians/alerts/acknowledge-all userId=${payload.sub} roomName=${roomName}`,
    );

    try {
      // roomName으로 Ward 찾기 (권한 확인용)
      const alert = await this.prisma.careAlertEvent.findFirst({
        where: { roomName },
        include: {
          ward: {
            include: {
              guardian: true,
              organization: true,
            },
          },
        },
      });

      if (!alert) {
        throw new HttpException(
          'No alerts found for this room',
          HttpStatus.NOT_FOUND,
        );
      }

      // Internal/Admin 요청인 경우 - 권한 확인 스킵
      const isInternal = 'role' in payload && payload.role === 'internal';
      const isAdmin = 'role' in payload && payload.role === 'admin';
      if (isInternal || isAdmin) {
        this.logger.log(
          `[API] acknowledgeAllAlerts authorized as ${isInternal ? 'Internal (Agent)' : 'Admin'}`,
        );
      }

      // 권한 확인
      let isAuthorized = isInternal || isAdmin;

      if (!isAuthorized) {
        const guardian = await this.prisma.guardian.findUnique({
          where: { userId: payload.sub },
        });
        if (guardian && alert.ward.guardianId === guardian.id) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        throw new HttpException(
          'Not authorized to acknowledge alerts for this room',
          HttpStatus.FORBIDDEN,
        );
      }

      // 전체 해제 처리
      const result = await this.careAlertsService.acknowledgeAllAlerts(
        roomName,
        payload.sub,
      );

      // LiveKit room metadata 업데이트
      if (alert.ward.organization) {
        this.logger.log(
          `[API] Emitting room-danger=false for roomName=${roomName} (acknowledge-all)`,
        );

        try {
          await this.livekitService.updateRoomMetadata(
            roomName,
            JSON.stringify({
              isDanger: false,
              dangerCode: '0000',
              timestamp: Date.now(),
            }),
          );
          this.logger.log(
            `[API] Updated room metadata: room=${roomName} isDanger=false`,
          );
        } catch (err) {
          this.logger.warn(
            `[API] Failed to update room metadata: ${(err as Error).message}`,
          );
        }

        this.eventsService.emit({
          type: 'room-danger',
          roomName,
          isDanger: false,
          name: `acknowledge-all:${roomName}`,
        });
      }

      return result;
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] acknowledgeAllAlerts error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to acknowledge all alerts',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Guardian용 - 알림 격상 API
   * PATCH /v1/guardians/alerts/:alertId/escalate
   * caution → critical로 격상
   */
  @Patch('guardians/alerts/:alertId/escalate')
  async escalateAlert(
    @Headers('authorization') authorization: string | undefined,
    @Param('alertId') alertId: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    this.logger.log(
      `[API] PATCH /v1/guardians/alerts/${alertId}/escalate userId=${payload.sub}`,
    );

    try {
      // Alert 조회 (ward, guardian, organization 포함)
      const alert = await this.prisma.careAlertEvent.findUnique({
        where: { id: alertId },
        include: {
          ward: {
            include: {
              guardian: true,
              organization: true,
              user: true,
            },
          },
        },
      });

      if (!alert) {
        throw new HttpException('Alert not found', HttpStatus.NOT_FOUND);
      }

      // Internal 요청인 경우 (Agent) - 권한 확인 스킵
      const isInternal = 'role' in payload && payload.role === 'internal';
      if (isInternal) {
        this.logger.log(
          `[API] escalateAlert authorized as Internal (Agent)`,
        );
      }

      // 권한 확인
      let isAuthorized = isInternal;

      if (!isAuthorized) {
        const guardian = await this.prisma.guardian.findUnique({
          where: { userId: payload.sub },
        });
        if (guardian && alert.ward.guardianId === guardian.id) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        throw new HttpException(
          'Not authorized to escalate this alert',
          HttpStatus.FORBIDDEN,
        );
      }

      // 격상 처리
      const result = await this.careAlertsService.escalateAlert(alertId);

      // LiveKit room metadata 업데이트 및 SSE 이벤트 전송
      if (result.roomName && alert.ward.organization) {
        const dangerCode = this.getDangerCode(result.alertType);
        const wardName = alert.ward.user.nickname ?? alert.ward.user.displayName ?? '어르신';

        this.logger.log(
          `[API] Emitting room-danger with riskLevel=critical for roomName=${result.roomName} (escalate)`,
        );

        try {
          await this.livekitService.updateRoomMetadata(
            result.roomName,
            JSON.stringify({
              isDanger: true,
              riskLevel: 'critical',
              dangerCode,
              alertType: result.alertType,
              wardId: result.wardId,
              escalatedFromCaution: true,
              timestamp: Date.now(),
            }),
          );
          this.logger.log(
            `[API] Updated room metadata: room=${result.roomName} riskLevel=critical escalatedFromCaution=true`,
          );
        } catch (err) {
          this.logger.warn(
            `[API] Failed to update room metadata: ${(err as Error).message}`,
          );
        }

        this.eventsService.emit({
          type: 'room-danger',
          roomName: result.roomName,
          isDanger: true,
          riskLevel: 'critical',
          name: `escalate:${alertId}`,
          wardId: result.wardId,
          wardName,
          alertType: result.alertType,
        });
      }

      return {
        success: result.success,
        alertId: result.alertId,
        newRiskLevel: result.newRiskLevel,
        escalatedFromCaution: result.escalatedFromCaution,
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(
        `[API] escalateAlert error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to escalate alert',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get danger code based on alert type
   */
  private getDangerCode(alertType: string): string {
    switch (alertType) {
      case 'device_fall':
        return '1000';
      case 'person_fall':
        return '0100';
      case 'loud_voice':
        return '0010';
      case 'emotion':
      case 'speech_keyword':
        return '0001';
      default:
        return '0000';
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
