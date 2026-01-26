import { Module, Global } from "@nestjs/common";
import { EventBus } from "./event_bus";

@Global()
@Module({
    providers: [EventBus],
    exports: [EventBus],
})
export class SharedModule { }
