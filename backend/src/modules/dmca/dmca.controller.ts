import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { Roles } from "../auth/roles.decorator";
import { hours } from "../shared/rate_limits";
import { DmcaService, type DmcaActor } from "./dmca.service";
import { AdminAudit, auditBody, auditCode, auditRef } from "../admin_audit/admin_audit.interceptor";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";

@Controller("api/dmca")
export class DmcaController {
  constructor(private readonly dmcaService: DmcaService) {}

  /**
   * File a DMCA takedown report.
   * POST /api/dmca/report
   *
   * Public (claimants may not have an account), rate limited per IP.
   * Returns only the new report's reference.
   */
  @Post("report")
  @Throttle({ default: { limit: 10, ttl: hours(1) } })
  async fileReport(
    @Body()
    body: {
      trackId: string;
      claimantName: string;
      claimantEmail: string;
      originalWorkUrl: string;
      reason: string;
    },
  ) {
    return this.dmcaService.fileReport(body);
  }

  /**
   * File a counter-notification.
   * POST /api/dmca/counter
   *
   * Signed-in owner/manager of the reported release, or admin/operator.
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("counter")
  async fileCounter(
    @Req() req: { user: DmcaActor },
    @Body() body: { reportId: string; counterNotice: string },
  ) {
    return this.dmcaService.fileCounter(
      body?.reportId,
      body?.counterNotice,
      req.user,
    );
  }

  /**
   * Resolve a DMCA report.
   * PATCH /api/dmca/:id/resolve
   *
   * Admin/operator only; the resolver is the authenticated caller.
   */
  @UseGuards(AuthGuard("jwt"))
  @Patch(":id/resolve")
  @Roles("admin", "operator")
  @RequireStepUp()
  @AdminAudit("dmca.report_resolved", (c) => ({
    detail: { reportId: auditRef(c.params.id), outcome: auditCode(auditBody(c).outcome, ["upheld", "rejected"] as const) },
  }))
  async resolveReport(
    @Req() req: { user: DmcaActor },
    @Param("id") id: string,
    @Body() body: { outcome: "upheld" | "rejected" },
  ) {
    return this.dmcaService.resolveReport(id, body?.outcome, req.user);
  }

  /**
   * List DMCA reports, including claimant contact details.
   * GET /api/dmca
   *
   * Admin/operator only.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get()
  @Roles("admin", "operator")
  @AdminAudit("dmca.reports_viewed", (c) => ({ detail: { status: auditRef(c.query.status) } }))
  async listReports(@Query("status") status?: string) {
    return this.dmcaService.listReports(status);
  }
}
