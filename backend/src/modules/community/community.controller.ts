import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CommunityCohortService } from "./community_cohort.service";
import { CommunityEligibilityService } from "./community_eligibility.service";
import { CommunityRoomsService } from "./community_rooms.service";
import { CommunityService } from "./community.service";

@Controller("community")
export class CommunityController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly communityEligibilityService: CommunityEligibilityService,
    private readonly communityRoomsService: CommunityRoomsService,
    private readonly communityCohortService: CommunityCohortService,
  ) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("profile/me")
  getMyProfile(@Req() req: any) {
    return this.communityService.getMyProfile(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("profile/me")
  updateMyProfile(@Req() req: any, @Body() body: Parameters<CommunityService["updateMyProfile"]>[1]) {
    return this.communityService.updateMyProfile(req.user.userId, body);
  }

  @Get("profile/:userId")
  getPublicProfile(@Param("userId") userId: string) {
    return this.communityService.getPublicProfile(userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("badges/me")
  getMyBadges(@Req() req: any) {
    return this.communityEligibilityService.listMyBadges(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("benefits/me")
  getMyBenefits(@Req() req: any) {
    return this.communityEligibilityService.listMyBenefits(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("benefits/:benefitRuleId/redeem")
  redeemBenefit(@Req() req: any, @Param("benefitRuleId") benefitRuleId: string) {
    return this.communityEligibilityService.redeemBenefit(req.user.userId, benefitRuleId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("artists/:artistId/rooms/enable")
  enableArtistCommunity(@Req() req: any, @Param("artistId") artistId: string) {
    return this.communityRoomsService.enableArtistCommunity(req.user.userId, artistId);
  }

  @Get("artists/:artistId/rooms")
  listArtistRooms(@Param("artistId") artistId: string) {
    return this.communityRoomsService.listArtistRooms(artistId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("artists/:artistId/rooms/me")
  listMyArtistRooms(@Req() req: any, @Param("artistId") artistId: string) {
    return this.communityRoomsService.listArtistRooms(artistId, req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("cohorts/suggestions")
  listCohortSuggestions(@Req() req: any) {
    return this.communityCohortService.listSuggestions(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("cohorts/:cohortId")
  getCohortDetail(@Req() req: any, @Param("cohortId") cohortId: string) {
    return this.communityCohortService.getCohortDetail(req.user.userId, cohortId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("cohorts/:cohortId/join")
  joinCohort(@Req() req: any, @Param("cohortId") cohortId: string) {
    return this.communityCohortService.joinCohort(req.user.userId, cohortId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("cohorts/:cohortId/leave")
  leaveCohort(@Req() req: any, @Param("cohortId") cohortId: string) {
    return this.communityCohortService.leaveCohort(req.user.userId, cohortId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("cohorts/:cohortId/hide")
  hideCohort(@Req() req: any, @Param("cohortId") cohortId: string) {
    return this.communityCohortService.hideCohort(req.user.userId, cohortId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("rooms/:roomId/join")
  joinRoom(@Req() req: any, @Param("roomId") roomId: string) {
    return this.communityRoomsService.joinRoom(req.user.userId, roomId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("rooms/:roomId/leave")
  leaveRoom(@Req() req: any, @Param("roomId") roomId: string) {
    return this.communityRoomsService.leaveRoom(req.user.userId, roomId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("rooms/:roomId/messages")
  listMessages(@Req() req: any, @Param("roomId") roomId: string) {
    return this.communityRoomsService.listMessages(req.user.userId, roomId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("rooms/:roomId/messages")
  createMessage(
    @Req() req: any,
    @Param("roomId") roomId: string,
    @Body() body: Parameters<CommunityRoomsService["createMessage"]>[2],
  ) {
    return this.communityRoomsService.createMessage(req.user.userId, roomId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("messages/:messageId/report")
  reportMessage(
    @Req() req: any,
    @Param("messageId") messageId: string,
    @Body() body: Parameters<CommunityRoomsService["reportMessage"]>[2],
  ) {
    return this.communityRoomsService.reportMessage(req.user.userId, messageId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Delete("messages/:messageId")
  deleteMessage(@Req() req: any, @Param("messageId") messageId: string) {
    return this.communityRoomsService.deleteMessage(req.user.userId, messageId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("rooms/:roomId/members/:userId/moderate")
  moderateMember(
    @Req() req: any,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
    @Body() body: Parameters<CommunityRoomsService["moderateMember"]>[3],
  ) {
    return this.communityRoomsService.moderateMember(req.user.userId, roomId, userId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("rooms/:roomId/status")
  updateRoomStatus(
    @Req() req: any,
    @Param("roomId") roomId: string,
    @Body() body: Parameters<CommunityRoomsService["updateRoomStatus"]>[2],
  ) {
    return this.communityRoomsService.updateRoomStatus(req.user.userId, roomId, body);
  }
}
