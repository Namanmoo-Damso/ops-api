import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export type UserEvent = {
  type: 'user-logout' | 'user-deleted';
  identity: string;
  userId: string;
  timestamp: string;
};

export type RoomEvent = {
  type:
    | 'room-created'
    | 'room-updated'
    | 'participant-joined'
    | 'participant-left'
    | 'room-danger';
  roomName: string;
  identity?: string;
  name?: string;
  isDanger?: boolean;
  wardId?: string;
  wardName?: string;
  alertType?: string;
  timestamp: string;
};

export type WardEvent = {
  type: 'ward-registered';
  organizationWardId: string;
  organizationId: string;
  wardName: string;
  timestamp: string;
};

export type AppEvent = UserEvent | RoomEvent | WardEvent;

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly events$ = new Subject<AppEvent>();
  private subscriberCount = 0;

  emit(
    event:
      | Omit<UserEvent, 'timestamp'>
      | Omit<RoomEvent, 'timestamp'>
      | Omit<WardEvent, 'timestamp'>,
  ): void {
    const fullEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    } as AppEvent;

    let logDetail = '';
    if ('roomName' in fullEvent) {
      logDetail = `room=${fullEvent.roomName}`;
    } else if ('identity' in fullEvent) {
      logDetail = `identity=${fullEvent.identity}`;
    } else if ('organizationWardId' in fullEvent) {
      logDetail = `organizationWardId=${fullEvent.organizationWardId} wardName=${fullEvent.wardName}`;
    }

    this.logger.log(
      `Emitting event: type=${fullEvent.type} ${logDetail} subscribers=${this.subscriberCount}`,
    );
    this.events$.next(fullEvent);
  }

  emitUserEvent(event: Omit<UserEvent, 'timestamp'>): void {
    this.emit(event);
  }

  emitRoomEvent(event: Omit<RoomEvent, 'timestamp'>): void {
    this.emit(event);
  }

  emitWardEvent(event: Omit<WardEvent, 'timestamp'>): void {
    this.emit(event);
  }

  getSubscriberCount(): number {
    return this.subscriberCount;
  }

  incrementSubscribers(): void {
    this.subscriberCount++;
    this.logger.log(`Subscriber added, total: ${this.subscriberCount}`);
  }

  decrementSubscribers(): void {
    this.subscriberCount--;
    this.logger.log(`Subscriber removed, total: ${this.subscriberCount}`);
  }

  subscribe(): Observable<MessageEvent> {
    return this.events$.asObservable().pipe(
      map(
        event =>
          ({
            data: JSON.stringify(event),
          }) as MessageEvent,
      ),
    );
  }

  subscribeToType(type: AppEvent['type']): Observable<MessageEvent> {
    return this.events$.asObservable().pipe(
      filter(event => event.type === type),
      map(
        event =>
          ({
            data: JSON.stringify(event),
          }) as MessageEvent,
      ),
    );
  }

  subscribeToRoomEvents(): Observable<MessageEvent> {
    return this.events$.asObservable().pipe(
      filter(event => 'roomName' in event),
      map(
        event =>
          ({
            data: JSON.stringify(event),
          }) as MessageEvent,
      ),
    );
  }
}
