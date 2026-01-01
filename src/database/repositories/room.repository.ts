/**
 * Room Repository
 * rooms, room_members 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { RoomMemberRow } from '../types';
import { toRoomMemberRow } from '../prisma-mappers';

@Injectable()
export class RoomRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listMembers(roomName: string): Promise<RoomMemberRow[]> {
    const members = await this.prisma.roomMember.findMany({
      where: {
        room: { roomName },
      },
      include: {
        user: {
          select: {
            identity: true,
            displayName: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) =>
      toRoomMemberRow({
        identity: m.user.identity,
        displayName: m.user.displayName,
        joinedAt: m.joinedAt,
      }),
    );
  }

  async createIfMissing(roomName: string): Promise<void> {
    await this.prisma.room.upsert({
      where: { roomName },
      update: {},
      create: { roomName },
    });
  }

  async upsertMember(params: {
    roomName: string;
    userId: string;
    role: string;
  }): Promise<{ roomId: string }> {
    const room = await this.prisma.room.upsert({
      where: { roomName: params.roomName },
      update: {},
      create: { roomName: params.roomName },
    });

    await this.prisma.roomMember.upsert({
      where: {
        roomId_userId: {
          roomId: room.id,
          userId: params.userId,
        },
      },
      update: {
        role: params.role,
        joinedAt: new Date(),
      },
      create: {
        roomId: room.id,
        userId: params.userId,
        role: params.role,
      },
    });

    return { roomId: room.id };
  }

  async deleteMembersByUserId(userId: string): Promise<void> {
    await this.prisma.roomMember.deleteMany({
      where: { userId },
    });
  }
}
