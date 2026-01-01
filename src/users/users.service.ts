import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DbService } from '../database';

@Injectable()
export class UsersService {
  constructor(private readonly dbService: DbService) {}

  async getUserInfo(userId: string) {
    const user = await this.dbService.findUserById(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    const baseResponse = {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      profileImageUrl: user.profile_image_url,
      userType: user.user_type,
      createdAt: user.created_at,
    };

    if (user.user_type === 'guardian') {
      const guardian = await this.dbService.findGuardianByUserId(user.id);
      const linkedWard = guardian
        ? await this.dbService.findWardByGuardianId(guardian.id)
        : undefined;

      return {
        ...baseResponse,
        guardianInfo: guardian
          ? {
              id: guardian.id,
              wardEmail: guardian.ward_email,
              wardPhoneNumber: guardian.ward_phone_number,
              linkedWard: linkedWard
                ? {
                    id: linkedWard.user_id,
                    nickname: linkedWard.user_nickname,
                    profileImageUrl: linkedWard.user_profile_image_url,
                  }
                : null,
            }
          : null,
      };
    } else if (user.user_type === 'ward') {
      const ward = await this.dbService.findWardByUserId(user.id);
      const linkedGuardian = ward?.guardian_id
        ? await this.dbService.findGuardianById(ward.guardian_id)
        : undefined;

      const guardianUser = linkedGuardian
        ? await this.dbService.findUserById(linkedGuardian.user_id)
        : null;

      return {
        ...baseResponse,
        wardInfo: ward
          ? {
              id: ward.id,
              phoneNumber: ward.phone_number,
              linkedGuardian: guardianUser
                ? {
                    id: guardianUser.id,
                    nickname: guardianUser.nickname,
                    profileImageUrl: guardianUser.profile_image_url,
                  }
                : null,
            }
          : null,
      };
    }

    return baseResponse;
  }

  async deleteUser(userId: string) {
    const user = await this.dbService.findUserById(userId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    await this.dbService.deleteUser(userId);
  }
}
