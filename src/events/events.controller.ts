import { Controller, Sse, Logger } from '@nestjs/common';
import { Observable, interval, merge, map } from 'rxjs';
import { tap, finalize } from 'rxjs/operators';
import { EventsService } from './events.service';

@Controller('v1/events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(private readonly eventsService: EventsService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    this.logger.log('SSE client connecting...');

    // 1. 이 요청만을 위한 15초 타이머가 생성됨
    const heartbeat$ = interval(15000).pipe(
      map(() => ({ data: { type: 'heartbeat' } }) as any),
    );

    this.eventsService.incrementSubscribers();

    return merge(this.eventsService.subscribe(), heartbeat$).pipe(
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
