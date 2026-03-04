import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ResonateEvent } from "../../events/event_types";
import { Subject, Subscription, filter } from "rxjs";

type Handler<T extends ResonateEvent> = (event: T) => void;

@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly logger = new Logger(EventBus.name);
  private readonly subject = new Subject<ResonateEvent>();

  publish(event: ResonateEvent): void {
    this.subject.next(event);
  }

  subscribe<T extends ResonateEvent>(
    eventName: T["eventName"],
    handler: Handler<T>,
  ): Subscription {
    return this.subject
      .pipe(filter((e): e is T => e.eventName === eventName))
      .subscribe({
        next: (event) => {
          try {
            handler(event);
          } catch (err) {
            this.logger.error(
              `Subscriber error on "${eventName}": ${(err as Error).message}`,
              (err as Error).stack,
            );
          }
        },
      });
  }

  destroy(): void {
    this.subject.complete();
  }

  onModuleDestroy(): void {
    this.destroy();
  }
}
