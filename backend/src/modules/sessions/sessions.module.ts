import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { EventBus } from "../shared/event_bus";
import { AgentOrchestrationService } from "./agent_orchestration.service";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [IdentityModule],
  controllers: [SessionsController],
  providers: [EventBus, AgentOrchestrationService, SessionsService],
})
export class SessionsModule {}
