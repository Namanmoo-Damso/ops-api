/**
 * User Repository
 * users, refresh_tokens 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { UserRow, RefreshTokenRow } from '../types';
import { toUserRow, toRefreshTokenRow } from '../prisma-mappers';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(identity: string, displayName?: string): Promise<UserRow> {
    const user = await this.prisma.user.upsert({
      where: { identity },
      update: {
        displayName: displayName ?? undefined,
        updatedAt: new Date(),
      },
      create: {
        identity,
        displayName: displayName ?? null,
      },
    });
    return toUserRow(user);
  }

  async findById(userId: string): Promise<UserRow | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    return user ? toUserRow(user) : undefined;
  }

  async findByKakaoId(kakaoId: string): Promise<UserRow | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { kakaoId },
    });
    return user ? toUserRow(user) : undefined;
  }

  async findByIdentity(identity: string): Promise<UserRow | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { identity },
    });
    return user ? toUserRow(user) : undefined;
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    return user ? toUserRow(user) : undefined;
  }

  async updateType(
    userId: string,
    userType: 'guardian' | 'ward',
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        userType,
        updatedAt: new Date(),
      },
    });
  }

  async createWithKakao(params: {
    kakaoId: string;
    email: string | null;
    nickname: string | null;
    profileImageUrl: string | null;
    userType: 'guardian' | 'ward' | null;
  }): Promise<UserRow> {
    const identity = `kakao_${params.kakaoId}`;
    const user = await this.prisma.user.create({
      data: {
        identity,
        displayName: params.nickname,
        userType: params.userType,
        email: params.email,
        nickname: params.nickname,
        profileImageUrl: params.profileImageUrl,
        kakaoId: params.kakaoId,
      },
    });
    return toUserRow(user);
  }

  async delete(userId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      // 1. Delete refresh tokens
      await tx.refreshToken.deleteMany({
        where: { userId },
      });

      // 2. Delete room members (모니터링 목록에서 제거)
      await tx.roomMember.deleteMany({
        where: { userId },
      });

      // 3. Delete devices (푸시 토큰 제거)
      await tx.device.deleteMany({
        where: { userId },
      });

      // 4. Unlink wards from guardian (if user is a guardian)
      const guardian = await tx.guardian.findUnique({
        where: { userId },
      });
      if (guardian) {
        await tx.ward.updateMany({
          where: { guardianId: guardian.id },
          data: { guardianId: null },
        });
        await tx.guardian.delete({
          where: { id: guardian.id },
        });
      }

      // 5. Reset organization ward links and delete ward record if user is a ward
      const ward = await tx.ward.findFirst({
        where: { userId },
      });
      if (ward) {
        // Reset OrganizationWard to allow re-registration
        await tx.organizationWard.updateMany({
          where: { wardId: ward.id },
          data: {
            wardId: null,
            isRegistered: false,
          },
        });
        await tx.ward.delete({
          where: { id: ward.id },
        });
      }

      // 6. Delete user
      await tx.user.delete({
        where: { id: userId },
      });
    });
  }

  // Refresh Token methods
  async saveRefreshToken(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        userId: params.userId,
        tokenHash: params.tokenHash,
        expiresAt: params.expiresAt,
      },
    });
  }

  async findRefreshToken(
    tokenHash: string,
  ): Promise<RefreshTokenRow | undefined> {
    const token = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
      },
    });
    return token ? toRefreshTokenRow(token) : undefined;
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash },
    });
  }

  async deleteUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }
}
