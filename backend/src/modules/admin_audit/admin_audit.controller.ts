import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { ListAdminAuditEventsQueryDto } from "./admin_audit.dto";
import { AdminAuditService } from "./admin_audit.service";

/**
 * The admin audit log (#2173). Admin only: it names every operator and every
 * account they touched, so an operator role does not reach it. The global
 * `RolesGuard` enforces `@Roles` (it authenticates the JWT itself).
 */
@Controller("admin/audit-events")
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin")
  @Get()
  list(@Query() query: ListAdminAuditEventsQueryDto) {
    return this.audit.list(query);
  }
}
