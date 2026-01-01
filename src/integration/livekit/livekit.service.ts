import { Injectable, Logger } from '@nestjs/common';
import { RoomServiceClient } from 'livekit-server-sdk';
import { ConfigService } from '../../core/config';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly roomService: RoomServiceClient;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.getConfig();
    this.roomService = new RoomServiceClient(
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
          const participants = await this.roomService.listParticipants(room.name);
          const participant = participants.find((p) => p.identity === identity);

          if (participant) {
            await this.roomService.removeParticipant(room.name, identity);
            this.logger.log(`removeParticipant room=${room.name} identity=${identity}`);
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
}
