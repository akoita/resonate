import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { HomeFeedService } from "./home-feed.service";
import { RecommendationsService, UserPreferences } from "./recommendations.service";
import { ApplyTasteEditsDto, PreviewTasteEditsDto } from "./taste_edit.dto";
import { TasteMemoryService } from "./taste_memory.service";

@Controller("recommendations")
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
    private readonly tasteMemoryService: TasteMemoryService,
    private readonly homeFeedService: HomeFeedService,
  ) {}

  /** Home feed v2 (#1454 WS-7): multi-rail personalized feed with categorical explanations. */
  @UseGuards(AuthGuard("jwt"))
  @Get(":userId/home-feed")
  getHomeFeed(@Param("userId") userId: string, @Req() req: any) {
    this.assertOwnUser(userId, req);
    return this.homeFeedService.getHomeFeed(userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("preferences")
  setPreferences(@Body() body: { userId: string; preferences: UserPreferences }, @Req() req: any) {
    this.assertOwnUser(body.userId, req);
    return this.recommendationsService.setPreferences(body.userId, body.preferences);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("taste-memory")
  getTasteMemory(@Req() req: any) {
    return this.tasteMemoryService.getTasteMemory(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Patch("taste-memory/settings")
  updateTasteMemorySettings(
    @Req() req: any,
    @Body() body: Parameters<TasteMemoryService["updateSettings"]>[1],
  ) {
    return this.tasteMemoryService.updateSettings(req.user.userId, body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("taste-memory/reset")
  resetTasteMemory(@Req() req: any) {
    return this.tasteMemoryService.resetTasteMemory(req.user.userId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("taste-memory/signals")
  upsertTasteSignalControl(
    @Req() req: any,
    @Body() body: Parameters<TasteMemoryService["upsertSignalControl"]>[1],
  ) {
    return this.tasteMemoryService.upsertSignalControl(req.user.userId, body);
  }

  /** Proposes edits for free text (#1961). Never writes. */
  @UseGuards(AuthGuard("jwt"))
  @Post("taste-memory/edits/preview")
  previewTasteEdits(@Body() body: PreviewTasteEditsDto) {
    return this.tasteMemoryService.previewTasteEdits(body.text);
  }

  /** Applies only the edits the listener confirmed (#1961). */
  @UseGuards(AuthGuard("jwt"))
  @Post("taste-memory/edits/apply")
  applyTasteEdits(@Req() req: any, @Body() body: ApplyTasteEditsDto) {
    return this.tasteMemoryService.applyTasteEdits(req.user.userId, body.items);
  }

  @UseGuards(AuthGuard("jwt"))
  @Delete("taste-memory/signals/:controlId")
  removeTasteSignalControl(@Req() req: any, @Param("controlId") controlId: string) {
    return this.tasteMemoryService.removeSignalControl(req.user.userId, controlId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get(":userId")
  getRecommendations(
    @Param("userId") userId: string,
    @Req() req: any,
    @Query("limit") limit?: string,
    @Query("mood") mood?: string,
    @Query("genres") genres?: string,
    @Query("energy") energy?: "low" | "medium" | "high",
    @Query("allowExplicit") allowExplicit?: string,
  ) {
    this.assertOwnUser(userId, req);
    const parsed = limit ? Number(limit) : 10;
    const parsedEnergy = energy === "low" || energy === "medium" || energy === "high"
      ? energy
      : undefined;
    return this.recommendationsService.getRecommendations(
      userId,
      Number.isNaN(parsed) ? 10 : parsed,
      {
        ...(mood ? { mood } : {}),
        ...(genres ? { genres: genres.split(",").map((genre) => genre.trim()).filter(Boolean) } : {}),
        ...(parsedEnergy ? { energy: parsedEnergy } : {}),
        ...(allowExplicit === undefined ? {} : { allowExplicit: allowExplicit === "true" }),
      },
    );
  }

  private assertOwnUser(userId: string, req: { user?: { userId?: string } }) {
    if (!req?.user?.userId || req.user.userId !== userId) {
      throw new ForbiddenException("Recommendations are restricted to the authenticated listener");
    }
  }

}
