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
import { DbService } from '../../database';
import { AiService } from '../../ai/ai.service';

@Controller('webhook/livekit')
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);
  private readonly webhookReceiver: WebhookReceiver;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventsService: EventsService,
    private readonly liveKitService: LiveKitService,
    private readonly dbService: DbService,
    private readonly aiService: AiService,
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

          // Mark call as answered when a non-agent/non-admin participant joins
          // This sets answeredAt timestamp for usage statistics
          const identity = participant.identity;
          const isAgent =
            identity?.startsWith('agent-') || identity === 'damso-agent';
          const isAdmin = identity?.startsWith('admin-');

          if (!isAgent && !isAdmin) {
            setImmediate(async () => {
              try {
                const callContext =
                  await this.dbService.getCallContextByRoomName(room.name);
                if (callContext?.call_id) {
                  await this.dbService.updateCallState(
                    callContext.call_id,
                    'answered',
                  );
                  this.logger.log(
                    `Call marked as answered callId=${callContext.call_id} room=${room.name} identity=${identity}`,
                  );
                }
              } catch (error) {
                this.logger.warn(
                  `Failed to mark call as answered room=${room.name}: ${(error as Error).message}`,
                );
              }
            });
          }
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

          // Clean up the specific room if only admin/agent remain
          setImmediate(() => {
            this.liveKitService.closeRoomIfAdminOnly(room.name);
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

          // Trigger call analysis for the room
          setImmediate(async () => {
            try {
              const callContext = await this.dbService.getCallContextByRoomName(
                room.name,
              );
              if (callContext?.call_id) {
                this.logger.log(
                  `Triggering call analysis for room=${room.name} callId=${callContext.call_id}`,
                );

                // Update call state to 'ended'
                await this.dbService.updateCallState(
                  callContext.call_id,
                  'ended',
                );

                // Check if already analyzed
                const existingSummary = await this.dbService.getCallSummary(
                  callContext.call_id,
                );
                if (existingSummary) {
                  this.logger.log(
                    `Call already analyzed callId=${callContext.call_id} summaryId=${existingSummary.id}`,
                  );
                  return;
                }

                // Trigger AI analysis
                const result = await this.aiService.analyzeCall(
                  callContext.call_id,
                );
                if (result.success) {
                  this.logger.log(
                    `Call analysis completed callId=${callContext.call_id} mood=${result.mood}`,
                  );
                } else {
                  this.logger.warn(
                    `Call analysis failed callId=${callContext.call_id} error=${result.error}`,
                  );
                }
              } else {
                // Fallback: end any non-ended calls for this room
                // This handles cases where getCallContextByRoomName returns null
                this.logger.warn(
                  `No call context found for room=${room.name}, attempting fallback cleanup`,
                );
                try {
                  const result = await this.dbService.endCallsByRoomName(
                    room.name,
                  );
                  if (result.count > 0) {
                    this.logger.log(
                      `Fallback cleanup ended ${result.count} call(s) for room=${room.name} callIds=[${result.callIds.join(', ')}]`,
                    );
                  } else {
                    this.logger.log(
                      `No calls to cleanup for room=${room.name}`,
                    );
                  }
                } catch (fallbackError) {
                  this.logger.error(
                    `Fallback cleanup failed for room=${room.name}: ${(fallbackError as Error).message}`,
                  );
                }
              }
            } catch (error) {
              this.logger.error(
                `Failed to trigger call analysis for room=${room.name}: ${(error as Error).message}`,
              );
            }
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
