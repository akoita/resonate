import { Module, Global, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventBus } from "./event_bus";
import { RedisCacheService } from "./redis_cache.service";
import { EventsGateway } from "./events.gateway";
import { CryptoService } from "./crypto.service";
import { KeyAuditService } from "./key_audit.service";
import { GenerationModule } from "../generation/generation.module";

@Global()
@Module({
    imports: [ConfigModule, forwardRef(() => GenerationModule)],
    providers: [EventBus, EventsGateway, CryptoService, KeyAuditService, RedisCacheService],
    exports: [EventBus, EventsGateway, CryptoService, KeyAuditService, RedisCacheService],
})
export class SharedModule { }

