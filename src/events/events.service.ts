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
  type: 'room-created' | 'room-updated' | 'participant-joined' | 'participant-left';
  roomName: string;
  identity?: string;
  name?: string;
  timestamp: string;
};

export type AppEvent = UserEvent | RoomEvent;

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly events$ = new Subject<AppEvent>();
  private subscriberCount = 0;

  emit(event: Omit<UserEvent, 'timestamp'> | Omit<RoomEvent, 'timestamp'>): void {
    const fullEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    } as AppEvent;
    this.logger.log(
      `Emitting event: type=${fullEvent.type} ${('roomName' in fullEvent) ? `room=${fullEvent.roomName}` : `identity=${fullEvent.identity}`} subscribers=${this.subscriberCount}`,
    );
    this.events$.next(fullEvent);
  }

  emitUserEvent(event: Omit<UserEvent, 'timestamp'>): void {
    this.emit(event);
  }

  emitRoomEvent(event: Omit<RoomEvent, 'timestamp'>): void {
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
