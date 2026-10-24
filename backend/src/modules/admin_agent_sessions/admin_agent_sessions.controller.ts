import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { AdminAgentSessionsService } from "./admin_agent_sessions.service";

/**
 * Operator view of one AI DJ session's raw agent events (#2259).
 *
 * Admin-only: unlike the users directory, an operator role does not reach it.
 * The global `RolesGuard` enforces `@Roles` (it authenticates the JWT itself).
 * The acting user comes from the token and is what the audit event names.
 */
@Controller("admin/agent-sessions")
export class AdminAgentSessionsController {
  constructor(private readonly sessions: AdminAgentSessionsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Get(":sessionId/events")
  events(@Req() req: any, @Param("sessionId") sessionId: string) {
    return this.sessions.events(req.user.userId as string, sessionId);
  }
}
