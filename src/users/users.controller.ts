import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthService } from '../auth';
import { LiveKitService } from '../integration/livekit';
import { DbService } from '../database';
import { EventsService } from '../events';
import { RegisterGuardianDto } from './dto';

@Controller('v1/users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly livekitService: LiveKitService,
    private readonly dbService: DbService,
    private readonly eventsService: EventsService,
  ) {}

  private verifyAuthHeader(authorization: string | undefined) {
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

    const payload = this.authService.verifyAccessToken(token);
    if (!payload) {
      throw new HttpException(
        'Invalid or expired access token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return payload;
  }

  @Post('register/guardian')
  async registerGuardian(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: RegisterGuardianDto,
  ) {
    const authHeader = authorization ?? '';
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;

    if (!accessToken) {
      throw new HttpException(
        'Access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const wardEmail = body.wardEmail?.trim();
    const wardPhoneNumber = body.wardPhoneNumber?.trim();

    if (!wardEmail) {
      throw new HttpException('wardEmail is required', HttpStatus.BAD_REQUEST);
    }
    if (!wardPhoneNumber) {
      throw new HttpException(
        'wardPhoneNumber is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!wardEmail.includes('@')) {
      throw new HttpException('Invalid email format', HttpStatus.BAD_REQUEST);
    }

    if (!/^[\d-]+$/.test(wardPhoneNumber)) {
      throw new HttpException(
        'Invalid phone number format',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      this.logger.log(`registerGuardian wardEmail=${wardEmail}`);
      const result = await this.authService.registerGuardian({
        accessToken,
        wardEmail,
        wardPhoneNumber,
      });
      return result;
    } catch (error) {
      if ((error as HttpException).getStatus?.() === HttpStatus.UNAUTHORIZED) {
        throw error;
      }
      this.logger.warn(
        `registerGuardian failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        (error as Error).message || 'Registration failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('me')
  async getMe(@Headers('authorization') authorization: string | undefined) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      const result = await this.usersService.getUserInfo(payload.sub);
      this.logger.log(`getMe userId=${result.id}`);
      return result;
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getMe failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get user info',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('me')
  async deleteMe(@Headers('authorization') authorization: string | undefined) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      this.logger.log(`deleteMe userId=${payload.sub}`);

      // 1. Get user identity for LiveKit
      const user = await this.dbService.findUserById(payload.sub);

      // 2. LiveKit에서 강제 퇴장 (관제 페이지 목록에서 즉시 제거)
      if (user?.identity) {
        await this.livekitService.removeParticipantFromAllRooms(user.identity);

        // SSE 이벤트 발행 (프론트엔드에서 목록 삭제)
        this.eventsService.emit({
          type: 'user-deleted',
          identity: user.identity,
          userId: payload.sub,
        });
      }

      // 3. Delete user and all related data
      await this.usersService.deleteUser(payload.sub);
      return {
        success: true,
        message: '회원탈퇴가 완료되었습니다.',
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`deleteMe failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to delete user',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
