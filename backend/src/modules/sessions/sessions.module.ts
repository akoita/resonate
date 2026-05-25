import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { AgentsModule } from "../agents/agents.module";
import { SharedModule } from "../shared/shared.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [SharedModule, IdentityModule, AgentsModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
