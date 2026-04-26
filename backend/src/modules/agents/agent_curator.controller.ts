import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AgentStemQualityService } from "./agent_stem_quality.service";

@Controller("agents/curator")
export class AgentCuratorController {
  constructor(private readonly stemQualityService: AgentStemQualityService) {}

  @Post("stems/:stemId/quality")
  @UseGuards(AuthGuard("jwt"))
  analyzeStemQuality(@Req() req: any, @Param("stemId") stemId: string) {
    return this.stemQualityService.analyzeStem({
      userId: req.user.userId,
      stemId,
    });
  }

  @Get("stems/:stemId/quality")
  @UseGuards(AuthGuard("jwt"))
  getStemQuality(@Param("stemId") stemId: string) {
    return this.stemQualityService.getStemRatings(stemId);
  }
}
