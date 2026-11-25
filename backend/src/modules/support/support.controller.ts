import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { AdminAudit, auditBody, auditCode, auditRef } from "../admin_audit/admin_audit.interceptor";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt.guard";
import { Roles } from "../auth/roles.decorator";
import { hours } from "../shared/rate_limits";
import { CreateSupportRequestDto, SUPPORT_STATUSES, UpdateSupportRequestDto } from "./support.dto";
import { SupportService } from "./support.service";

/**
 * Support requests (#2667). Anyone may write, signed in or not; operators
 * read them and mark them answered or closed.
 */
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /**
   * POST /support/requests — public; a valid session links the request to the
   * person. Rate limited per IP here and per person/address in the service.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: hours(1) } })
  @Post("support/requests")
  create(@Req() req: { user?: { userId?: string } }, @Body() body: CreateSupportRequestDto) {
    return this.support.create(req.user?.userId ?? null, body);
  }

  /** GET /admin/support/requests — operator list, including reply addresses. */
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @AdminAudit("support.requests_viewed", (c) => ({
    detail: { status: auditCode(c.query.status, SUPPORT_STATUSES) },
  }))
  @Get("admin/support/requests")
  list(@Query("status") status?: string) {
    return this.support.list(status);
  }

  /** PATCH /admin/support/requests/:id — set new, answered or closed. */
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @AdminAudit("support.request_status_changed", (c) => ({
    detail: { requestId: auditRef(c.params.id), status: auditCode(auditBody(c).status, SUPPORT_STATUSES) },
  }))
  @Patch("admin/support/requests/:id")
  setStatus(@Req() req: { user: { userId: string } }, @Param("id") id: string, @Body() body: UpdateSupportRequestDto) {
    return this.support.setStatus(id, body.status, req.user.userId);
  }
}
