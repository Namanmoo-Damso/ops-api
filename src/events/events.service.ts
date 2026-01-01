import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export type UserEvent = {
  type: 'user-logout' | 'user-deleted';
  identity: string;
  userId: string;
  timestamp: string;
};

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly events$ = new Subject<UserEvent>();
  private subscriberCount = 0;

  emit(event: Omit<UserEvent, 'timestamp'>): void {
    const fullEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    this.logger.log(
      `Emitting event: type=${fullEvent.type} identity=${fullEvent.identity} subscribers=${this.subscriberCount}`,
    );
    this.events$.next(fullEvent);
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
      map((event) => ({
        data: JSON.stringify(event),
      } as MessageEvent)),
    );
  }

  subscribeToType(type: UserEvent['type']): Observable<MessageEvent> {
    return this.events$.asObservable().pipe(
      filter((event) => event.type === type),
      map((event) => ({
        data: JSON.stringify(event),
      } as MessageEvent)),
    );
  }
}
