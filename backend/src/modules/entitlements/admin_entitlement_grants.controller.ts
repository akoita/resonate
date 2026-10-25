import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AdminAudit, auditCode, auditRef, auditResult } from "../admin_audit/admin_audit.interceptor";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { EntitlementGrantsService } from "./entitlement_grants.service";
import { CreateEntitlementGrantDto, ListEntitlementGrantsQueryDto } from "./entitlements.dto";
import { ENTITLEMENT_GRANT_PLANS, ENTITLEMENT_GRANT_SOURCES } from "./entitlements.policy";

/**
 * Admin grants of the `pro` plan (#2406, `docs/rfc/artist-pro.md` §4): for
 * founders, partners and support. Admin only: an operator can read the
 * platform's queues but does not hand out plans.
 *
 * Creating and revoking need a fresh step-up proof (`@RequireStepUp()`) and are
 * recorded in the admin audit log with ids and codes only; the admin's note
 * (`reason`) is never part of the record. Under policy `entitlements/v1`
 * (`everyone`) a grant changes nothing a person can do yet: it makes their plan
 * read `pro` (Usage & Billing shows "Pro (granted)").
 */
@Controller("admin/entitlements/grants")
export class AdminEntitlementGrantsController {
  constructor(private readonly grants: EntitlementGrantsService) {}

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get()
  list(@Query() query: ListEntitlementGrantsQueryDto) {
    return this.grants.listForUser(query.userId);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @RequireStepUp()
  @Post()
  @AdminAudit("entitlement_grant.created", (c) => {
    const grant = auditResult(c);
    return {
      targetUserId: auditRef(grant.userId) ?? null,
      detail: {
        grantId: auditRef(grant.id),
        plan: auditCode(grant.plan, ENTITLEMENT_GRANT_PLANS),
        source: auditCode(grant.source, ENTITLEMENT_GRANT_SOURCES),
        validUntil: auditRef(grant.validUntil),
      },
    };
  })
  create(@Req() req: any, @Body() dto: CreateEntitlementGrantDto) {
    return this.grants.create(req.user.userId, dto);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @RequireStepUp()
  @HttpCode(200)
  @Delete(":id")
  @AdminAudit("entitlement_grant.revoked", (c) => {
    const grant = auditResult(c);
    return {
      targetUserId: auditRef(grant.userId) ?? null,
      detail: { grantId: auditRef(c.params.id), plan: auditCode(grant.plan, ENTITLEMENT_GRANT_PLANS) },
    };
  })
  revoke(@Req() req: any, @Param("id") id: string) {
    return this.grants.revoke(req.user.userId, id);
  }
}
