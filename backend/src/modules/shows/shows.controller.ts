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
import { ShowsService } from "./shows.service";

@Controller("shows")
export class ShowsController {
  constructor(
    private readonly showsService: ShowsService,
    private readonly communityRoomsService: CommunityRoomsService,
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

  @Get("campaigns/:slug")
  getCampaign(@Param("slug") slug: string) {
    return this.showsService.getCampaign(slug);
  }

  // #949: operator/owner-scoped read (sensitive authority evidence + disputes).
  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator", "artist")
  @Get("campaigns/:id/manage")
  getManagedCampaign(@Param("id") id: string, @Request() req: any) {
    return this.showsService.getManagedCampaign(this.actorFromRequest(req), id);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("campaigns/:id/community")
  getCampaignCommunity(@Param("id") id: string, @Request() req: any) {
    return this.communityRoomsService.getShowCampaignCommunity(req.user.userId, id);
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

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("artist", "admin", "operator")
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
  @Roles("artist", "admin", "operator")
  @Post("campaigns")
  createCampaign(@Request() req: any, @Body() body: any) {
    return this.showsService.createDraftCampaign(this.actorFromRequest(req), body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("artist", "admin", "operator")
  @Patch("campaigns/:id")
  updateCampaign(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.updateDraftCampaign(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("artist", "admin", "operator")
  @Patch("campaigns/:id/visuals")
  @UseInterceptors(FileFieldsInterceptor([
    { name: "hero", maxCount: 1 },
    { name: "card", maxCount: 1 },
    { name: "gallery", maxCount: 8 },
  ]))
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
  @Roles("artist", "admin", "operator")
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
  @Roles("artist", "admin", "operator")
  @Patch("campaigns/:id/visuals/:visualRef")
  @UseInterceptors(FileInterceptor("visual"))
  replaceCampaignVisual(
    @Param("id") id: string,
    @Param("visualRef") visualRef: string,
    @Request() req: any,
    @UploadedFile() visual?: Express.Multer.File,
  ) {
    return this.showsService.replaceCampaignVisual(this.actorFromRequest(req), id, visualRef, visual ?? null);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("artist", "admin", "operator")
  @Delete("campaigns/:id/visuals/:visualRef")
  deleteCampaignVisual(
    @Param("id") id: string,
    @Param("visualRef") visualRef: string,
    @Request() req: any,
  ) {
    return this.showsService.deleteCampaignVisual(this.actorFromRequest(req), id, visualRef);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("artist", "admin", "operator")
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
  expireAuthority(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.expireAuthority(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("artist", "admin", "operator")
  @Post("campaigns/:id/activate")
  activateCampaign(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.activateCampaign(this.actorFromRequest(req), id, body);
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

  @UseGuards(AuthGuard("jwt"))
  @Post("pledges/:id/refund/confirm")
  confirmPledgeRefund(
    @Param("id") id: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    return this.showsService.confirmPledgeRefund(this.actorFromRequest(req), id, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("artist", "admin", "operator")
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
