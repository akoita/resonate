import { Module, Global, forwardRef } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventBus } from "./event_bus";
import { RedisCacheService } from "./redis_cache.service";
import { EventsGateway } from "./events.gateway";
import { CryptoService } from "./crypto.service";
import { KeyAuditService } from "./key_audit.service";
import { SessionOwnerResolver } from "./session_owner.resolver";
import { DECISION_CLIENT } from "./decision/decision_client";
import { createDecisionClient } from "./decision/gemini_decision_client";
import { GenerationModule } from "../generation/generation.module";

@Global()
@Module({
    imports: [ConfigModule, forwardRef(() => GenerationModule)],
    providers: [EventBus, EventsGateway, CryptoService, KeyAuditService, RedisCacheService, SessionOwnerResolver,
        { provide: DECISION_CLIENT, useFactory: () => createDecisionClient() },
    ],
    exports: [EventBus, EventsGateway, CryptoService, KeyAuditService, RedisCacheService, DECISION_CLIENT],
})
export class SharedModule { }

