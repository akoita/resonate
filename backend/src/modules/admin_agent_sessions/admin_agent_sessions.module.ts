import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AdminAgentSessionsController } from "./admin_agent_sessions.controller";
import { AdminAgentSessionsService } from "./admin_agent_sessions.service";

/** Operator view of a session's raw agent events (#2259). Reads existing analytics events. */
@Module({
  imports: [AnalyticsModule],
  controllers: [AdminAgentSessionsController],
  providers: [AdminAgentSessionsService],
})
export class AdminAgentSessionsModule {}
