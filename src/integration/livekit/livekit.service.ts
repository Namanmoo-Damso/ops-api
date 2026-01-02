import { Injectable, Logger } from '@nestjs/common';
import { RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';
import { ConfigService } from '../../core/config';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly roomService: RoomServiceClient;
  private readonly agentDispatchService: AgentDispatchClient;
  private readonly livekitUrl: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getConfig();
    this.livekitUrl = config.livekitUrl;
    this.roomService = new RoomServiceClient(
      config.livekitUrl,
      config.livekitApiKey,
      config.livekitApiSecret,
    );
    this.agentDispatchService = new AgentDispatchClient(
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
   * Close rooms that only have admin participants
   */
  async closeAdminOnlyRooms(): Promise<void> {
    try {
      const rooms = await this.roomService.listRooms();

      for (const room of rooms) {
        const participants = await this.roomService.listParticipants(room.name);

        // Check if all participants are admins
        const hasOnlyAdmins =
          participants.length > 0 &&
          participants.every(p => p.identity.startsWith('admin_'));

        if (hasOnlyAdmins) {
          this.logger.log(`Closing admin-only room: ${room.name}`);

          // Remove all admin participants to close the room
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
        }
      }
    } catch (err) {
      this.logger.warn(`closeAdminOnlyRooms failed: ${(err as Error).message}`);
    }
  }

  /**
   * Dispatch AI agent to a LiveKit room
   * Creates the room first, then dispatches the agent
   */
  async dispatchAgentToRoom(roomName: string): Promise<void> {
    try {
      // First, ensure the room exists
      await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 60, // Room auto-closes after 60 seconds if empty
        maxParticipants: 10,
      });
      this.logger.log(`Created room: ${roomName}`);

      // [Agent 명시적 호출]
      // LiveKit Cloud에 'voice-assistant'라는 이름의 Agent를 해당 방으로 보내달라고 요청
      // Agent의 agent_name 설정과 정확히 일치해야 함
      const dispatch = await this.agentDispatchService.createDispatch(
        roomName,
        'voice-assistant', // Python Agent의 agent_name과 동일해야 함
      );

      this.logger.log(
        `Created agent dispatch for room: ${roomName}, dispatch_id: ${dispatch.id}`,
      );
    } catch (err) {
      // If room already exists, that's ok - just try to dispatch
      if ((err as Error).message.includes('already exists')) {
        try {
          const dispatch = await this.agentDispatchService.createDispatch(
            roomName,
            'voice-assistant', // Explicit agent name
          );
          this.logger.log(
            `Room exists, created agent dispatch: ${roomName}, dispatch_id: ${dispatch.id}`,
          );
        } catch (dispatchErr) {
          this.logger.error(
            `Failed to dispatch agent to existing room ${roomName}: ${(dispatchErr as Error).message}`,
          );
          throw dispatchErr;
        }
      } else {
        this.logger.error(
          `Failed to dispatch agent to room ${roomName}: ${(err as Error).message}`,
        );
        throw err;
      }
    }
  }
}
