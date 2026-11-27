import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RECENT_DEFAULT_LIMIT, RECENT_MAX_LIMIT } from "./listening_recent.aggregate";
import { ListeningRecentService } from "./listening_recent.service";

function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === "") return RECENT_DEFAULT_LIMIT;
  const value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > RECENT_MAX_LIMIT) {
    throw new BadRequestException(`limit must be between 1 and ${RECENT_MAX_LIMIT}`);
  }
  return value;
}

/**
 * What the listener played most recently (Home's "Jump back in"). The listener
 * is always the authenticated JWT user; there is no userId parameter.
 */
@Controller("listening/recent")
export class ListeningRecentController {
  constructor(private readonly recent: ListeningRecentService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"))
  getRecent(@Req() req: any, @Query("limit") limit?: string) {
    return this.recent.getRecent(req.user.userId, { limit: parseLimit(limit) });
  }
}
