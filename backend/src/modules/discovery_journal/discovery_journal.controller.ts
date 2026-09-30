import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  DEFAULT_LIMIT,
  DEFAULT_WINDOW_DAYS,
  DiscoveryJournalService,
  MAX_LIMIT,
  MAX_WINDOW_DAYS,
} from "./discovery_journal.service";

function parseBoundedInt(
  name: string,
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw.trim())) {
    throw new BadRequestException(`${name} must be an integer`);
  }
  return Math.min(max, Math.max(min, Number.parseInt(raw, 10)));
}

/**
 * Sonic Radar discovery journal (ADR-TE-5). The listener is always the
 * authenticated JWT user; there is no userId parameter to tamper with.
 */
@Controller("agents/discoveries")
export class DiscoveryJournalController {
  constructor(private readonly journal: DiscoveryJournalService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"))
  getDiscoveries(
    @Req() req: any,
    @Query("windowDays") windowDays?: string,
    @Query("limit") limit?: string,
  ) {
    return this.journal.getJournal(req.user.userId, {
      windowDays: parseBoundedInt("windowDays", windowDays, DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS),
      limit: parseBoundedInt("limit", limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    });
  }
}
