import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { AdminAudit, auditBody, auditCode, auditNumber, auditRef, auditResult } from "../admin_audit/admin_audit.interceptor";
import { CreateInvitationDto } from "./invitations.dto";
import { InvitationsService } from "./invitations.service";

/**
 * Operator side of invitation-only registration (#2662): create, list and
 * revoke codes, and work the waiting list. Every route is in the admin audit
 * log; the code itself is never recorded.
 */
@Controller("admin")
export class AdminInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Get("invitations")
  @AdminAudit("invitations.viewed", () => ({}))
  list() {
    return this.invitations.list();
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("invitations")
  @AdminAudit("invitation.created", (c) => ({
    detail: {
      invitationId: auditRef(auditResult(c).id),
      role: auditCode(auditBody(c).role, ["listener", "artist"] as const),
      maxUses: auditNumber(auditBody(c).maxUses),
      expiresInDays: auditNumber(auditBody(c).expiresInDays),
    },
  }))
  create(@Request() req: any, @Body() body: CreateInvitationDto) {
    return this.invitations.create(req.user.userId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("invitations/:id/revoke")
  @AdminAudit("invitation.revoked", (c) => ({ detail: { invitationId: auditRef(c.params.id) } }))
  revoke(@Param("id") id: string) {
    return this.invitations.revoke(id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Get("waitlist")
  @AdminAudit("waitlist.viewed", (c) => ({ detail: { entries: Array.isArray(c.result) ? c.result.length : undefined } }))
  waitlist() {
    return this.invitations.listWaitlist();
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("waitlist/:id/invite")
  @AdminAudit("waitlist.entry_invited", (c) => ({
    detail: { entryId: auditRef(c.params.id), invitationId: auditRef(auditResult(c).id) },
  }))
  invite(@Request() req: any, @Param("id") id: string) {
    return this.invitations.inviteWaitlistEntry(req.user.userId, id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Delete("waitlist/:id")
  @AdminAudit("waitlist.entry_deleted", (c) => ({ detail: { entryId: auditRef(c.params.id) } }))
  deleteEntry(@Param("id") id: string) {
    return this.invitations.deleteWaitlistEntry(id);
  }
}
