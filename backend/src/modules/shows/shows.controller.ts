import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { ShowsService } from "./shows.service";

@Controller("shows")
export class ShowsController {
  constructor(private readonly showsService: ShowsService) {}

  @Get("campaigns")
  listCampaigns(
    @Query("includeSignals") includeSignals?: string,
    @Query("status") status?: string,
  ) {
    return this.showsService.listCampaigns({
      includeSignals: includeSignals === "true",
      status,
    });
  }

  @Get("campaigns/:slug")
  getCampaign(@Param("slug") slug: string) {
    return this.showsService.getCampaign(slug);
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

  private actorFromRequest(req: any) {
    return {
      userId: req.user.userId,
      role: req.user.role,
    };
  }
}
