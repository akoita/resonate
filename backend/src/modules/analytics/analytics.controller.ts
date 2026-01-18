import { Controller, Get, Param, Query } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("artist/:id")
  getArtist(
    @Param("id") artistId: string,
    @Query("days") days?: string
  ) {
    return this.analyticsService.getArtistStats(artistId, Number(days ?? 7));
  }
}
