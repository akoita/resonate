import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FileFieldsInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CommunityRoomsService } from "../community/community_rooms.service";
import { ShowRefundReminderService } from "./show-refund-reminder.service";
import { ShowsService } from "./shows.service";
import { AllowWhileSuspended } from "../accounts/allow_while_suspended.decorator";
import {
  getShowsVisualMaxBytes,
  getShowsVisualMaxTotalBytes,
} from "../shared/artwork-validation";
import { ContentLengthLimitInterceptor } from "../shared/content-length-limit.interceptor";
import { BoundedMemoryStorage } from "../shared/bounded-memory.storage";
import { AdminAudit, auditBody, auditCode, auditRef } from "../admin_audit/admin_audit.interceptor";

@Controller("shows")
export class ShowsController {
  constructor(
    private readonly showsService: ShowsService,
    private readonly communityRoomsService: CommunityRoomsService,
    private readonly refundReminders: ShowRefundReminderService,
  ) {}

  @Get("campaigns")
  listCampaigns(
    @Query("includeSignals") includeSignals?: string,
    @Query("status") status?: string,
    @Query("scope") scope?: string,
  ) {
    return this.showsService.listCampaigns({
      includeSignals: includeSignals === "true",
      status,
      scope,
    });
  }

  // #2130: resolves a slug or the internal campaign id.
  @Get("campaigns/:slug")
  getCampaign(@Param("slug") slugOrId: string) {
    return this.showsService.getCampaign(slugOrId);
  }

  // #2128: artist-side campaign routes (manage, create/update drafts, visuals,
  // request-authority, activate, cancel, campaign updates) require sign-in only.
  // Authority is the service's ownership check (campaign artist owner/manager,
  // or admin/operator), not a JWT role: no `artist` JWT role is ever issued.
  // #949: operator/owner-scoped read (sensitive authority evidence + disputes).
  @UseGuards(AuthGuard("jwt"))
  @Get("campaigns/:id/manage")
  getManagedCampaign(@Param("id") id: string, @Request() req: any) {
    return this.showsService.getManagedCampaign(this.actorFromRequest(req), id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("campaigns/:id/community")
  getCampaignCommunity(@Param("id") id: string, @Request() req: any) {
    return this.communityRoomsService.getShowCampaignCommunity(req.user.userId, id, req.user.role);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/community/join")
  joinCampaignCommunity(@Param("id") id: string, @Request() req: any) {
    return this.communityRoomsService.joinShowCampaignCommunity(req.user.userId, id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/community/city-interest/join")
  joinCampaignCityInterest(@Param("id") id: string, @Request() req: any) {
    return this.communityRoomsService.joinShowCampaignCityDemand(req.user.userId, id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/community/updates")
  createCampaignUpdate(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.communityRoomsService.createShowCampaignUpdate(this.actorFromRequest(req), id, body);
  }

  @Get("campaigns/:id/visuals/:visualRef")
  async getCampaignVisual(
    @Param("id") id: string,
    @Param("visualRef") visualRef: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visual = await this.showsService.getCampaignVisual(id, visualRef);
    if (!visual) {
      res.status(404).send("Campaign visual not found");
      return;
    }
    res.set({
      "Content-Type": visual.mimeType,
      "Cache-Control": "public, max-age=300",
    });
    return new StreamableFile(visual.data);
  }

  @Get("campaigns/:id/visuals/:visualRef/v:artworkRevision")
  async getVersionedCampaignVisual(
    @Param("id") id: string,
    @Param("visualRef") visualRef: string,
    @Param("artworkRevision") artworkRevision: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const visual = await this.showsService.getCampaignVisual(id, visualRef, artworkRevision);
    if (!visual) {
      res.status(404).send("Campaign visual not found");
      return;
    }
    res.set({
      "Content-Type": visual.mimeType,
      "Cache-Control": "public, max-age=300",
    });
    return new StreamableFile(visual.data);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("me/pledges")
  getMyPledges(
    @Request() req: any,
    @Query("walletAddress") walletAddress?: string,
    @Query("chainId") chainId?: string,
  ) {
    return this.showsService.getMyPledges(this.actorFromRequest(req), {
      walletAddress,
      chainId,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("signals")
  createSignal(@Request() req: any, @Body() body: any) {
    return this.showsService.createSignal(this.actorFromRequest(req), body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns")
  createCampaign(@Request() req: any, @Body() body: any) {
    return this.showsService.createDraftCampaign(this.actorFromRequest(req), body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("campaigns/:id")
  updateCampaign(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.updateDraftCampaign(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("campaigns/:id/visuals")
  @UseInterceptors(
    new ContentLengthLimitInterceptor(getShowsVisualMaxTotalBytes(), "Campaign visual"),
    FileFieldsInterceptor([
      { name: "hero", maxCount: 1 },
      { name: "card", maxCount: 1 },
      { name: "gallery", maxCount: 8 },
    ], {
      storage: new BoundedMemoryStorage({
        maxTotalBytes: getShowsVisualMaxTotalBytes(),
        fieldMaxBytes: {
          hero: getShowsVisualMaxBytes(),
          card: getShowsVisualMaxBytes(),
          gallery: getShowsVisualMaxBytes(),
        },
        label: "Campaign visual",
      }),
      limits: { fileSize: getShowsVisualMaxBytes() },
    }),
  )
  uploadCampaignVisuals(
    @Param("id") id: string,
    @Request() req: any,
    @UploadedFiles() files: {
      hero?: Express.Multer.File[];
      card?: Express.Multer.File[];
      gallery?: Express.Multer.File[];
    },
  ) {
    return this.showsService.uploadCampaignVisuals(this.actorFromRequest(req), id, {
      hero: files?.hero?.[0],
      card: files?.card?.[0],
      gallery: files?.gallery ?? [],
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("campaigns/:id/visuals/order")
  reorderCampaignVisuals(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.reorderCampaignVisuals(this.actorFromRequest(req), id, {
      visualIds: Array.isArray(body?.visualIds) ? body.visualIds : [],
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("campaigns/:id/visuals/:visualRef")
  @UseInterceptors(FileInterceptor("visual", { limits: { fileSize: getShowsVisualMaxBytes() } }))
  replaceCampaignVisual(
    @Param("id") id: string,
    @Param("visualRef") visualRef: string,
    @Request() req: any,
    @UploadedFile() visual?: Express.Multer.File,
  ) {
    return this.showsService.replaceCampaignVisual(this.actorFromRequest(req), id, visualRef, visual ?? null);
  }

  @UseGuards(AuthGuard("jwt"))
  @Delete("campaigns/:id/visuals/:visualRef")
  deleteCampaignVisual(
    @Param("id") id: string,
    @Param("visualRef") visualRef: string,
    @Request() req: any,
  ) {
    return this.showsService.deleteCampaignVisual(this.actorFromRequest(req), id, visualRef);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/request-authority")
  requestAuthority(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.requestAuthority(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Patch("campaigns/:id/authority")
  @AdminAudit("show_authority.approved", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  approveAuthority(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.approveAuthority(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("campaigns/:id/reject-authority")
  @AdminAudit("show_authority.rejected", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  rejectAuthority(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.rejectAuthority(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("campaigns/:id/revoke-authority")
  @AdminAudit("show_authority.revoked", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  revokeAuthority(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.revokeAuthority(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("campaigns/:id/expire-authority")
  @AdminAudit("show_authority.expired", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  expireAuthority(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.expireAuthority(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/activate")
  activateCampaign(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.activateCampaign(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("campaigns/:id/resync-chain")
  @AdminAudit("show_campaign.chain_resynced", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  resyncCampaignFromChain(
    @Param("id") id: string,
    @Request() req: any,
  ) {
    return this.showsService.resyncCampaignFromChain(this.actorFromRequest(req), id);
  }

  // #1271 ops tool + drift-drill assertion surface: list reconciliation
  // mismatches the escrow indexer detected (durable analytics facts), newest
  // first. Operator/admin only.
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Get("operator/reconciliation-mismatches")
  listReconciliationMismatches(
    @Request() req: any,
    @Query("contractCampaignId") contractCampaignId?: string,
    @Query("sinceMinutes") sinceMinutes?: string,
    @Query("limit") limit?: string,
  ) {
    return this.showsService.listReconciliationMismatches(this.actorFromRequest(req), {
      contractCampaignId,
      sinceMinutes: sinceMinutes !== undefined ? Number(sinceMinutes) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  // #2149: refunds that are claimable but unclaimed, per campaign. Database
  // state only (no RPC). Operator/admin only.
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Get("operator/unclaimed-refunds")
  listUnclaimedRefunds(
    @Request() req: any,
    @Query("campaignId") campaignId?: string,
  ) {
    return this.refundReminders.getUnclaimedRefunds(this.actorFromRequest(req), {
      campaignId: campaignId || undefined,
    });
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("operator/reconciliation-mismatches/:contractCampaignId/acknowledge")
  @AdminAudit("show_reconciliation.acknowledged", (c) => ({ detail: { contractCampaignId: auditRef(c.params.contractCampaignId) } }))
  acknowledgeReconciliationMismatch(
    @Param("contractCampaignId") contractCampaignId: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.acknowledgeReconciliationMismatch(
      this.actorFromRequest(req),
      contractCampaignId,
      body ?? {},
    );
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Delete("operator/reconciliation-mismatches/:contractCampaignId/acknowledgement")
  @AdminAudit("show_reconciliation.acknowledgement_removed", (c) => ({ detail: { contractCampaignId: auditRef(c.params.contractCampaignId) } }))
  removeReconciliationAcknowledgement(
    @Param("contractCampaignId") contractCampaignId: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.removeReconciliationAcknowledgement(
      this.actorFromRequest(req),
      contractCampaignId,
      body ?? {},
    );
  }

  // #1390 Tier 2: operator-only, read-only on-chain discovery of the contract
  // campaign id by matching the draft's deterministic escrow terms.
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin", "operator")
  @Post("campaigns/:id/discover-onchain")
  @AdminAudit("show_campaign.onchain_discovered", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  discoverOnChainCampaign(
    @Param("id") id: string,
    @Request() req: any,
  ) {
    return this.showsService.discoverOnChainCampaign(this.actorFromRequest(req), id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/pledges/intent")
  createPledgeIntent(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.createPledgeIntent(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("pledges/:id/confirm")
  confirmPledge(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.confirmPledge(this.actorFromRequest(req), id, body);
  }

  // A refund is the backer's money: it is never blocked by suspension (#2147).
  @UseGuards(AuthGuard("jwt"))
  @AllowWhileSuspended()
  @Post("pledges/:id/refund/confirm")
  confirmPledgeRefund(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.confirmPledgeRefund(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("campaigns/:id/cancel")
  cancelCampaign(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.cancelCampaign(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("campaigns/:id/confirm-booking")
  @AdminAudit("show_campaign.booking_confirmed", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  confirmBooking(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.confirmBooking(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("campaigns/:id/confirm-fulfillment")
  @AdminAudit("show_campaign.fulfillment_confirmed", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  confirmFulfillment(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.confirmFulfillment(this.actorFromRequest(req), id, body);
  }

  // #950: off-chain dispute workflow (operator-driven MVP).
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Post("campaigns/:id/dispute")
  @AdminAudit("show_dispute.opened", (c) => ({ detail: { campaignId: auditRef(c.params.id) } }))
  initiateDispute(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.initiateDispute(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Patch("campaigns/:id/dispute/:disputeId/resolve")
  @AdminAudit("show_dispute.resolved", (c) => ({
    detail: {
      campaignId: auditRef(c.params.id),
      disputeId: auditRef(c.params.disputeId),
      outcome: auditCode(auditBody(c).outcome, ["upheld", "rejected", "inconclusive"] as const),
    },
  }))
  resolveDispute(
    @Param("id") id: string,
    @Param("disputeId") disputeId: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.resolveDispute(this.actorFromRequest(req), id, disputeId, body);
  }

  private actorFromRequest(req: any) {
    return {
      userId: req.user.userId,
      role: req.user.role,
    };
  }
}
