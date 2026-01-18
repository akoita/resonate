import { Injectable } from "@nestjs/common";
import { ResonateEvent } from "../../events/event_types";

type Handler<T extends ResonateEvent> = (event: T) => void;

@Injectable()
export class EventBus {
  private handlers: { [key: string]: Handler<ResonateEvent>[] } = {};

  publish(event: ResonateEvent) {
    const handlers = this.handlers[event.eventName] ?? [];
    handlers.forEach((handler) => handler(event));
  }

  subscribe<T extends ResonateEvent>(eventName: T["eventName"], handler: Handler<T>) {
    if (!this.handlers[eventName]) {
      this.handlers[eventName] = [];
    }
    this.handlers[eventName].push(handler as Handler<ResonateEvent>);
  }
}
