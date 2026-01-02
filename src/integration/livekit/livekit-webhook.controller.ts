import {
  Controller,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';
import { ConfigService } from '../../core/config';
import { EventsService } from '../../events/events.service';
import { LiveKitService } from './livekit.service';

@Controller('webhook/livekit')
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);
  private readonly webhookReceiver: WebhookReceiver;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventsService: EventsService,
    private readonly liveKitService: LiveKitService,
  ) {
    const config = this.configService.getConfig();
    this.webhookReceiver = new WebhookReceiver(
      config.livekitApiKey,
      config.livekitApiSecret,
    );
  }

  @Post()
  async handleWebhook(
    @Body() body: any,
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: any,
  ) {
    try {
      // Debug logging
      this.logger.log(`Webhook body type: ${typeof body}`);
      this.logger.log(`Webhook body: ${JSON.stringify(body)}`);
      this.logger.log(`Content-Type: ${headers['content-type']}`);

      // TEMPORARY: Skip signature verification to debug
      // Parse the body directly without verification
      const event = body;

      if (!event) {
        this.logger.error('Event is undefined or null');
        throw new Error('Event body is missing');
      }

      this.logger.log(
        `LiveKit webhook received (no verification): ${event.event}`,
      );

      // Handle participant joined event
      if (event.event === 'participant_joined') {
        const participant = event.participant;
        const room = event.room;

        if (participant && room) {
          this.logger.log(
            `participant_joined room=${room.name} identity=${participant.identity} name=${participant.name}`,
          );

          this.eventsService.emitRoomEvent({
            type: 'participant-joined',
            roomName: room.name,
            identity: participant.identity,
            name: participant.name || participant.identity,
          });
        }
      }

      // Handle participant left event
      if (event.event === 'participant_left') {
        const participant = event.participant;
        const room = event.room;

        if (participant && room) {
          this.logger.log(
            `participant_left room=${room.name} identity=${participant.identity} name=${participant.name}`,
          );

          this.eventsService.emitRoomEvent({
            type: 'participant-left',
            roomName: room.name,
            identity: participant.identity,
            name: participant.name || participant.identity,
          });

          // Clean up admin-only rooms after a participant leaves
          setImmediate(() => {
            this.liveKitService.closeAdminOnlyRooms();
          });
        }
      }

      // Handle room finished event (all participants left)
      if (event.event === 'room_finished') {
        const room = event.room;

        if (room) {
          this.logger.log(`room_finished room=${room.name}`);

          this.eventsService.emitRoomEvent({
            type: 'room-updated',
            roomName: room.name,
          });
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`LiveKit webhook error: ${(error as Error).message}`);
      throw new HttpException('Invalid webhook', HttpStatus.BAD_REQUEST);
    }
  }
}
