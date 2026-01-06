import { Injectable, Logger } from '@nestjs/common';
import {
  RoomServiceClient,
  AgentDispatchClient,
  DataPacket_Kind,
} from 'livekit-server-sdk';
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

  async deleteRoom(roomName: string) {
    return this.roomService.deleteRoom(roomName);
  }

  /**
   * Update room metadata - used for signaling takeover state to agent
   */
  async updateRoomMetadata(roomName: string, metadata: string): Promise<void> {
    try {
      await this.roomService.updateRoomMetadata(roomName, metadata);
      this.logger.log(
        `Updated room metadata: room=${roomName}, metadata=${metadata}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to update room metadata: ${(err as Error).message}`,
      );
      throw err;
    }
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

  /**
   * Send data message to all participants in a room
   * Used for signaling takeover start/end to the agent
   */
  async sendDataToRoom(
    roomName: string,
    data: string,
    destinationIdentities?: string[],
  ): Promise<void> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      await this.roomService.sendData(
        roomName,
        dataBytes,
        DataPacket_Kind.RELIABLE,
        { destinationIdentities },
      );

      this.logger.log(
        `Data message sent to room=${roomName}: ${data}${destinationIdentities ? ` (to: ${destinationIdentities.join(', ')})` : ''}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send data to room=${roomName}: ${(err as Error).message}`,
      );
      throw err;
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
  /**
   * Mute or unmute a participant's audio track
   * Used for admin takeover to silence the AI agent
   */
  async muteParticipantAudio(
    roomName: string,
    identity: string,
    mute: boolean,
  ): Promise<void> {
    try {
      const participants = await this.roomService.listParticipants(roomName);
      const participant = participants.find(p => p.identity === identity);

      if (!participant) {
        this.logger.warn(
          `Participant ${identity} not found in room ${roomName}`,
        );
        return;
      }

      // Find the audio track
      const audioTrack = participant.tracks.find(
        t => t.type === 1, // AUDIO type
      );

      if (!audioTrack) {
        this.logger.debug(
          `No audio track found for participant ${identity} (may not be published yet)`,
        );
        return; // Don't throw - agent might not have published audio yet
      }

      await this.roomService.mutePublishedTrack(
        roomName,
        identity,
        audioTrack.sid,
        mute,
      );

      this.logger.log(
        `${mute ? 'Muted' : 'Unmuted'} audio for ${identity} in room ${roomName}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to ${mute ? 'mute' : 'unmute'} audio for ${identity}: ${(err as Error).message}`,
      );
      // Don't throw - subscription control is more important
    }
  }

  /**
   * Control agent audio subscriptions during takeover
   * When mute=true: Agent unsubscribes from all non-agent audio (can't hear iOS user)
   * When mute=false: Agent resubscribes to all audio (can hear iOS user again)
   */
  async updateAgentSubscriptions(
    roomName: string,
    mute: boolean,
  ): Promise<void> {
    try {
      const participants = await this.roomService.listParticipants(roomName);

      // Find agent participants
      const agents = participants.filter(p => p.identity.startsWith('agent-'));

      if (agents.length === 0) {
        this.logger.warn(`No agents found in room ${roomName}`);
        return;
      }

      // Find all non-agent audio tracks (these are what the agent should/shouldn't hear)
      const nonAgentAudioTracks: string[] = [];
      for (const participant of participants) {
        // Skip agents and admins
        if (
          participant.identity.startsWith('agent-') ||
          participant.identity.startsWith('admin_')
        ) {
          continue;
        }

        // Find audio tracks
        for (const track of participant.tracks) {
          if (track.type === 1) {
            // AUDIO type = 1
            nonAgentAudioTracks.push(track.sid);
          }
        }
      }

      if (nonAgentAudioTracks.length === 0) {
        this.logger.debug(
          `No non-agent audio tracks found in room ${roomName}`,
        );
        return;
      }

      // Update subscriptions for each agent
      for (const agent of agents) {
        try {
          await this.roomService.updateSubscriptions(
            roomName,
            agent.identity,
            nonAgentAudioTracks,
            !mute, // subscribe when unmute=true, unsubscribe when mute=true
          );

          this.logger.log(
            `${mute ? 'Unsubscribed' : 'Subscribed'} agent ${agent.identity} ${mute ? 'from' : 'to'} ${nonAgentAudioTracks.length} audio track(s)`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to update subscriptions for agent ${agent.identity}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to update agent subscriptions in room ${roomName}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Control iOS client subscriptions to agent audio during takeover
   * When mute=true: iOS client unsubscribes from agent audio (can't hear agent)
   * When mute=false: iOS client resubscribes to agent audio (can hear agent again)
   */
  async updateIosSubscriptionsToAgent(
    roomName: string,
    mute: boolean,
  ): Promise<void> {
    try {
      const participants = await this.roomService.listParticipants(roomName);

      // Find iOS/real user participants (not agents or admins)
      const iosUsers = participants.filter(
        p =>
          !p.identity.startsWith('agent-') && !p.identity.startsWith('admin_'),
      );

      if (iosUsers.length === 0) {
        this.logger.debug(`No iOS users found in room ${roomName}`);
        return;
      }

      // Find all agent audio tracks
      const agentAudioTracks: string[] = [];
      for (const participant of participants) {
        if (!participant.identity.startsWith('agent-')) {
          continue;
        }

        // Find audio tracks
        for (const track of participant.tracks) {
          if (track.type === 1) {
            // AUDIO type = 1
            agentAudioTracks.push(track.sid);
          }
        }
      }

      if (agentAudioTracks.length === 0) {
        this.logger.debug(
          `No agent audio tracks found in room ${roomName} (agent may not be speaking)`,
        );
        return;
      }

      // Update subscriptions for each iOS user
      for (const iosUser of iosUsers) {
        try {
          await this.roomService.updateSubscriptions(
            roomName,
            iosUser.identity,
            agentAudioTracks,
            !mute, // subscribe when unmute=true, unsubscribe when mute=true
          );

          this.logger.log(
            `${mute ? 'Unsubscribed' : 'Subscribed'} iOS user ${iosUser.identity} ${mute ? 'from' : 'to'} ${agentAudioTracks.length} agent audio track(s)`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to update agent subscriptions for iOS user ${iosUser.identity}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to update iOS subscriptions to agent in room ${roomName}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Mute or unmute the AI agent in a room
   * This now controls BOTH what the agent hears (subscriptions) AND what iOS users hear (subscriptions)
   */
  async muteAgentInRoom(roomName: string, mute: boolean): Promise<void> {
    try {
      const participants = await this.roomService.listParticipants(roomName);

      // Find agent participants
      const agents = participants.filter(p => p.identity.startsWith('agent-'));

      if (agents.length === 0) {
        this.logger.warn(`No agents found in room ${roomName}`);
        return;
      }

      // Step 1: Control what the agent HEARS (agent unsubscribes from iOS audio)
      await this.updateAgentSubscriptions(roomName, mute);

      // Step 2: Control what iOS users HEAR from agent (iOS unsubscribes from agent audio)
      await this.updateIosSubscriptionsToAgent(roomName, mute);

      // Step 3: Send data message to agent for direct control
      const agentIdentities = agents.map(a => a.identity);
      const message = mute ? 'takeover:start' : 'takeover:end';
      await this.sendDataToRoom(roomName, message, agentIdentities);

      // Step 4: Update room metadata (PRIMARY MECHANISM - agent listens for this)
      const metadata = JSON.stringify({
        takeover: mute,
        timestamp: Date.now(),
      });
      await this.updateRoomMetadata(roomName, metadata);

      this.logger.log(
        `${mute ? 'Muted' : 'Unmuted'} ${agents.length} agent(s) in room ${roomName} (subscriptions + data + metadata)`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to ${mute ? 'mute' : 'unmute'} agents in room ${roomName}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

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

          let removedCount = 0;
          for (const participant of participants) {
            try {
              await this.roomService.removeParticipant(
                room.name,
                participant.identity,
              );
              removedCount++;
            } catch (err) {
              this.logger.error(
                `Failed to remove participant ${participant.identity}: ${(err as Error).message}`,
              );
            }
          }

          this.logger.log(
            `Removed ${removedCount}/${participants.length} participants from room: ${room.name}`,
          );

          // Re-check if any real users joined during cleanup
          const updatedParticipants = await this.roomService.listParticipants(
            room.name,
          );
          const stillHasNoRealUsers = !updatedParticipants.some(
            p =>
              !p.identity.startsWith('admin_') &&
              !p.identity.startsWith('agent-'),
          );

          if (!stillHasNoRealUsers) {
            this.logger.log(
              `Real user joined ${room.name} during cleanup, skipping deletion`,
            );
            continue;
          }

          // Delete the room after removing participants
          try {
            await this.roomService.deleteRoom(room.name);
            this.logger.log(`Deleted room: ${room.name}`);
          } catch (err) {
            this.logger.warn(
              `Failed to delete room ${room.name} (removed ${removedCount} participants): ${(err as Error).message}`,
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(`closeAdminOnlyRooms failed: ${(err as Error).message}`);
    }
  }
}
