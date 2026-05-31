import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CommunityEligibilityService } from "./community_eligibility.service";
import { CommunityService } from "./community.service";

@Controller("community")
export class CommunityController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly communityEligibilityService: CommunityEligibilityService,
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
}
