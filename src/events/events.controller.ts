import { Controller, Sse, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, finalize } from 'rxjs/operators';
import { EventsService } from './events.service';

@Controller('v1/events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly eventsService: EventsService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    this.logger.log('SSE client connecting...');
    this.eventsService.incrementSubscribers();

    return this.eventsService.subscribe().pipe(
      tap(event => {
        this.logger.log(`Sending SSE event: ${event.data}`);
      }),
      finalize(() => {
        this.logger.log('SSE client disconnected');
        this.eventsService.decrementSubscribers();
      }),
    );
  }
}
