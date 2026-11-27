import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  DEFAULT_LISTENING_STATS_WINDOW,
  LISTENING_STATS_WINDOWS,
  type ListeningStatsWindow,
} from "./listening_stats.aggregate";
import { ListeningStatsService } from "./listening_stats.service";

function parseWindow(raw: unknown): ListeningStatsWindow {
  if (raw === undefined || raw === "") return DEFAULT_LISTENING_STATS_WINDOW;
  const value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!(LISTENING_STATS_WINDOWS as readonly number[]).includes(value)) {
    throw new BadRequestException(`days must be one of ${LISTENING_STATS_WINDOWS.join(", ")}`);
  }
  return value as ListeningStatsWindow;
}

/**
 * The listener's own listening stats. The listener is always the
 * authenticated JWT user; there is no userId parameter to tamper with.
 */
@Controller("listening/stats")
export class ListeningStatsController {
  constructor(private readonly stats: ListeningStatsService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"))
  getStats(@Req() req: any, @Query("days") days?: string) {
    return this.stats.getStats(req.user.userId, { windowDays: parseWindow(days) });
  }
}
