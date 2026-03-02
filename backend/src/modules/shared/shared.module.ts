import { Module, Global, forwardRef } from "@nestjs/common";
import { EventBus } from "./event_bus";
import { EventsGateway } from "./events.gateway";
import { CryptoService } from "./crypto.service";
import { KeyAuditService } from "./key_audit.service";
import { GenerationModule } from "../generation/generation.module";

@Global()
@Module({
    imports: [forwardRef(() => GenerationModule)],
    providers: [EventBus, EventsGateway, CryptoService, KeyAuditService],
    exports: [EventBus, EventsGateway, CryptoService, KeyAuditService],
})
export class SharedModule { }


