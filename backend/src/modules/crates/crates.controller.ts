import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { minutes } from "../shared/rate_limits";
import { CreateCrateRequestDto } from "./crate.dto";
import type { CreateCrateResponse, GetCrateResponse } from "./crate.dto";
import { CratesService } from "./crates.service";

/** Tracked per signed-in person where the guard has resolved them, else per IP. */
const trackByUser = (req: Record<string, any>) => req.user?.userId ?? req.ip;

/**
 * Crate Digger HTTP surface (#1962, docs/rfc/taste-engine.md §5.1-5.2).
 *
 * The user id comes from the JWT (`req.user.userId`) and nowhere else. Free for
 * everyone today; the entitlement is exposed on the crate DTO, not enforced
 * here (crate-entitlements.ts).
 */
@Controller("crates")
export class CratesController {
  constructor(private readonly crates: CratesService) {}

  /**
   * Builds and persists a draft crate from text, a reference track or edited
   * filters. A request digs through a bounded catalog pool and ranks it, so it
   * carries its own throttle.
   */
  @UseGuards(AuthGuard("jwt"))
  @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
  @Post("requests")
  createRequest(
    @Req() req: any,
    @Body() body: CreateCrateRequestDto,
  ): Promise<CreateCrateResponse> {
    return this.crates.createFromRequest(req.user.userId, body);
  }

  /** The signed-in user's own crate; anyone else's is a 404. */
  @UseGuards(AuthGuard("jwt"))
  @Get(":id")
  getCrate(@Req() req: any, @Param("id") id: string): Promise<GetCrateResponse> {
    return this.crates.getCrate(req.user.userId, id);
  }
}
