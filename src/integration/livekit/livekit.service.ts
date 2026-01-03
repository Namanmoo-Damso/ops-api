import { Injectable, Logger } from '@nestjs/common';
import { RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';
import { ConfigService } from '../../core/config';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly roomService: RoomServiceClient;
  private readonly agentDispatch: AgentDispatchClient;
  private readonly livekitUrl: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getConfig();
    this.livekitUrl = config.livekitUrl;
    this.roomService = new RoomServiceClient(
      config.livekitUrl,
      config.livekitApiKey,
      config.livekitApiSecret,
    );
    this.agentDispatch = new AgentDispatchClient(
      config.livekitUrl,
      config.livekitApiKey,
      config.livekitApiSecret,
    );
  }

  /**
   * LiveKit에서 특정 사용자를 모든 room에서 강제 퇴장
   */
  async removeParticipantFromAllRooms(identity: string): Promise<void> {
    try {
      // 활성 room 목록 조회
      const rooms = await this.roomService.listRooms();

      for (const room of rooms) {
        try {
          // 각 room에서 해당 participant 조회
          const participants = await this.roomService.listParticipants(
            room.name,
          );
          const participant = participants.find(p => p.identity === identity);

          if (participant) {
            await this.roomService.removeParticipant(room.name, identity);
            this.logger.log(
              `removeParticipant room=${room.name} identity=${identity}`,
            );
          }
        } catch (err) {
          // participant가 없거나 이미 나간 경우 무시
          this.logger.debug(
            `removeParticipant failed room=${room.name} identity=${identity} error=${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `removeParticipantFromAllRooms failed identity=${identity} error=${(err as Error).message}`,
      );
    }
  }

  async listRooms() {
    return this.roomService.listRooms();
  }

  async listParticipants(roomName: string) {
    return this.roomService.listParticipants(roomName);
  }

  async removeParticipant(roomName: string, identity: string) {
    return this.roomService.removeParticipant(roomName, identity);
  }

  /**
   * Dispatch a voice agent to join the room
   */
  async dispatchVoiceAgent(
    roomName: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const metadataStr = metadata ? JSON.stringify(metadata) : undefined;
      await this.agentDispatch.createDispatch(roomName, 'voice-agent', {
        metadata: metadataStr,
      });
      this.logger.log(`Voice agent dispatched to room=${roomName}`);
    } catch (err) {
      this.logger.warn(
        `Failed to dispatch voice agent to room=${roomName}: ${(err as Error).message}`,
      );
    }
  }

  async getRoomsSummary() {
    const rooms = await this.roomService.listRooms();
    const summaries = await Promise.all(
      rooms.map(async room => {
        const participants = await this.roomService.listParticipants(room.name);
        return {
          name: room.name,
          metadata: room.metadata ?? null,
          createdAt: room.creationTime
            ? new Date(Number(room.creationTime)).toISOString()
            : null,
          numParticipants: participants.length,
          numPublishers: room.numPublishers ?? null,
          participants: participants.map(participant => ({
            identity: participant.identity,
            name: participant.name ?? participant.identity,
            metadata: participant.metadata ?? null,
            joinedAt: participant.joinedAt
              ? new Date(Number(participant.joinedAt)).toISOString()
              : null,
          })),
        };
      }),
    );

    const totalParticipants = summaries.reduce(
      (sum, room) => sum + room.numParticipants,
      0,
    );

    return {
      livekitUrl: this.livekitUrl,
      totalRooms: summaries.length,
      totalParticipants,
      rooms: summaries,
    };
  }

  /**
   * Close rooms that only have admin and/or agent participants
   * (i.e., no real users like kakao_ or google_ users remain)
   * Also deletes empty rooms
   */
  async closeAdminOnlyRooms(): Promise<void> {
    try {
      const rooms = await this.roomService.listRooms();

      for (const room of rooms) {
        const participants = await this.roomService.listParticipants(room.name);

        // Delete empty rooms
        if (participants.length === 0) {
          this.logger.log(`Deleting empty room: ${room.name}`);
          try {
            await this.roomService.deleteRoom(room.name);
          } catch (err) {
            this.logger.debug(
              `Failed to delete empty room ${room.name}: ${(err as Error).message}`,
            );
          }
          continue;
        }

        // Check if there are any real users (not admin or agent)
        const hasRealUsers = participants.some(
          p =>
            !p.identity.startsWith('admin_') &&
            !p.identity.startsWith('agent-'),
        );

        // If no real users remain (only admin and/or agent), close the room
        if (!hasRealUsers) {
          this.logger.log(
            `Closing room with only admin/agent participants: ${room.name}`,
          );

          // Remove all participants first, then delete the room
          for (const participant of participants) {
            try {
              await this.roomService.removeParticipant(
                room.name,
                participant.identity,
              );
            } catch (err) {
              this.logger.debug(
                `Failed to remove participant ${participant.identity} from ${room.name}: ${(err as Error).message}`,
              );
            }
          }

          // Delete the room after removing participants
          try {
            await this.roomService.deleteRoom(room.name);
            this.logger.log(`Deleted room: ${room.name}`);
          } catch (err) {
            this.logger.debug(
              `Failed to delete room ${room.name}: ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(`closeAdminOnlyRooms failed: ${(err as Error).message}`);
    }
  }
}
