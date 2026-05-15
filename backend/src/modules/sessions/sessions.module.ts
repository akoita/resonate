import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { AgentsModule } from "../agents/agents.module";
import { EventBus } from "../shared/event_bus";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [IdentityModule, AgentsModule],
  controllers: [SessionsController],
  providers: [EventBus, SessionsService],
})
export class SessionsModule {}
