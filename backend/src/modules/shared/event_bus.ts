import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ResonateEvent } from "../../events/event_types";
import { Subject, Subscription, filter } from "rxjs";

type Handler<T extends ResonateEvent> = (event: T) => void | Promise<void> | unknown;

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
            const result = handler(event);
            // If handler returns a Promise (async), catch its rejections
            if (result && typeof (result as any).catch === 'function') {
              (result as any).catch((err: Error) => {
                this.logger.error(
                  `Async subscriber error on "${eventName}": ${err.message}`,
                  err.stack,
                );
              });
            }
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
