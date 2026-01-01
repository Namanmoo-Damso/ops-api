/**
 * Device Repository
 * devices 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { UserRow, DeviceRow } from '../types';
import { toUserRow, toDeviceRow } from '../prisma-mappers';

@Injectable()
export class DeviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    user: UserRow,
    params: {
      platform: string;
      env: string;
      apnsToken?: string;
      voipToken?: string;
      supportsCallKit?: boolean;
    },
  ): Promise<{ user: UserRow; device: DeviceRow | undefined }> {
    const supportsCallkit = params.supportsCallKit ?? true;
    let device: DeviceRow | undefined;

    if (params.apnsToken) {
      const clearVoip = supportsCallkit === false && !params.voipToken;
      const result = await this.prisma.device.upsert({
        where: { apnsToken: params.apnsToken },
        update: {
          userId: user.id,
          platform: params.platform,
          supportsCallkit,
          ...(clearVoip && { voipToken: null }),
          env: params.env,
          lastSeen: new Date(),
        },
        create: {
          userId: user.id,
          platform: params.platform,
          apnsToken: params.apnsToken,
          voipToken: null,
          supportsCallkit,
          env: params.env,
          lastSeen: new Date(),
        },
      });
      device = toDeviceRow(result);
    }

    if (params.voipToken) {
      if (device) {
        // Clear voip_token from other devices
        await this.prisma.device.updateMany({
          where: {
            voipToken: params.voipToken,
            id: { not: device.id },
          },
          data: {
            voipToken: null,
            lastSeen: new Date(),
          },
        });
        const result = await this.prisma.device.update({
          where: { id: device.id },
          data: {
            voipToken: params.voipToken,
            supportsCallkit,
            env: params.env,
            lastSeen: new Date(),
          },
        });
        device = toDeviceRow(result);
      } else {
        const result = await this.prisma.device.upsert({
          where: { voipToken: params.voipToken },
          update: {
            userId: user.id,
            platform: params.platform,
            supportsCallkit,
            env: params.env,
            lastSeen: new Date(),
          },
          create: {
            userId: user.id,
            platform: params.platform,
            voipToken: params.voipToken,
            supportsCallkit,
            env: params.env,
            lastSeen: new Date(),
          },
        });
        device = toDeviceRow(result);
      }
    }

    return { user, device };
  }

  async listByIdentity(params: {
    identity: string;
    env?: string;
    tokenType?: 'apns' | 'voip';
  }): Promise<DeviceRow[]> {
    const env = params.env ?? 'production';
    const tokenFilter =
      params.tokenType === 'voip'
        ? { voipToken: { not: null } }
        : { apnsToken: { not: null } };

    const devices = await this.prisma.device.findMany({
      where: {
        user: { identity: params.identity },
        env,
        ...tokenFilter,
      },
    });
    return devices.map(toDeviceRow);
  }

  async listAllByIdentity(params: { identity: string; env?: string }): Promise<DeviceRow[]> {
    const devices = await this.prisma.device.findMany({
      where: {
        user: { identity: params.identity },
        ...(params.env && { env: params.env }),
        OR: [{ apnsToken: { not: null } }, { voipToken: { not: null } }],
      },
    });
    return devices.map(toDeviceRow);
  }

  async findUserByToken(params: {
    tokenType: 'apns' | 'voip';
    token: string;
    env?: string;
  }): Promise<(UserRow & { device_id: string }) | undefined> {
    const env = params.env ?? 'production';
    const tokenFilter =
      params.tokenType === 'voip'
        ? { voipToken: params.token }
        : { apnsToken: params.token };

    const device = await this.prisma.device.findFirst({
      where: {
        ...tokenFilter,
        env,
      },
      include: {
        user: true,
      },
    });

    if (!device?.user) return undefined;
    return { ...toUserRow(device.user), device_id: device.id };
  }

  async list(params: { tokenType: 'apns' | 'voip'; env?: string }): Promise<DeviceRow[]> {
    const env = params.env ?? 'production';
    const tokenFilter =
      params.tokenType === 'voip'
        ? { voipToken: { not: null } }
        : { apnsToken: { not: null } };

    const devices = await this.prisma.device.findMany({
      where: {
        env,
        ...tokenFilter,
      },
    });
    return devices.map(toDeviceRow);
  }

  async invalidateToken(tokenType: 'apns' | 'voip', token: string): Promise<void> {
    if (tokenType === 'voip') {
      await this.prisma.device.updateMany({
        where: { voipToken: token },
        data: { voipToken: null },
      });
    } else {
      await this.prisma.device.updateMany({
        where: { apnsToken: token },
        data: { apnsToken: null },
      });
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.device.deleteMany({
      where: { userId },
    });
  }
}
