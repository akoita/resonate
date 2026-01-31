import { Module, Global } from "@nestjs/common";
import { EventBus } from "./event_bus";
import { EventsGateway } from "./events.gateway";

@Global()
@Module({
    providers: [EventBus, EventsGateway],
    exports: [EventBus, EventsGateway],
})
export class SharedModule { }
