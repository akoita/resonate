import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RecommendationsService, UserPreferences } from "./recommendations.service";

@Controller("recommendations")
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("preferences")
  setPreferences(@Body() body: { userId: string; preferences: UserPreferences }) {
    return this.recommendationsService.setPreferences(body.userId, body.preferences);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get(":userId")
  getRecommendations(@Param("userId") userId: string, @Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : 10;
    return this.recommendationsService.getRecommendations(
      userId,
      Number.isNaN(parsed) ? 10 : parsed
    );
  }
}
