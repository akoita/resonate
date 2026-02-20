import { Module, Global, forwardRef } from "@nestjs/common";
import { EventBus } from "./event_bus";
import { EventsGateway } from "./events.gateway";
import { GenerationModule } from "../generation/generation.module";

@Global()
@Module({
    imports: [forwardRef(() => GenerationModule)],
    providers: [EventBus, EventsGateway],
    exports: [EventBus, EventsGateway],
})
export class SharedModule { }
