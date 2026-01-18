import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsIngestService: AnalyticsIngestService
  ) {}

  @Get("artist/:id")
  getArtist(
    @Param("id") artistId: string,
    @Query("days") days?: string
  ) {
    return this.analyticsService.getArtistStats(artistId, Number(days ?? 7));
  }

  @Post("ingest")
  ingest(@Body() body: { eventName: string; payload: Record<string, unknown> }) {
    return this.analyticsIngestService.ingest({
      eventName: body.eventName,
      payload: body.payload,
      occurredAt: new Date().toISOString(),
    });
  }

  @Get("rollup/daily")
  rollup() {
    return this.analyticsIngestService.dailyRollup();
  }
}
