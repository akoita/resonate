import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { CommunityService } from "./community.service";

@Controller("community")
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

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
}
