import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt.guard";
import { PunchlineCollectService } from "./punchline-collect.service";
import { PunchlineDropService } from "./punchline-drop.service";
import { PunchlineX402Service } from "./punchline-x402.service";
import { PunchlineMetricsService } from "./punchline-metrics.service";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";
import {
  PunchlineUnlockService,
  SetDropUnlockInput,
} from "./punchline-unlock.service";
import { Put } from "@nestjs/common";

@Controller("punchline")
export class PunchlineController {
  constructor(
    private readonly eligibilityService: PunchlineEligibilityService,
    private readonly dropService: PunchlineDropService,
    private readonly collectService: PunchlineCollectService,
    private readonly x402Service: PunchlineX402Service,
    private readonly unlockService: PunchlineUnlockService,
    private readonly metricsService: PunchlineMetricsService,
  ) {}

  /**
   * Explainable eligibility check for creating a Punchline Drop from a track
   * (#480). JWT-guarded; the create/publish APIs re-run the same gate
   * server-side. Returns allow/deny with typed reasons and the collectible
   * rights label so the UI can render the gate and the rights posture together.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get("eligibility")
  checkEligibility(@Query("trackId") trackId?: string) {
    if (!trackId) {
      throw new BadRequestException("trackId query parameter is required");
    }
    return this.eligibilityService.checkEligibility(trackId);
  }

  // ---------------------------------------------------------------------------
  // Draft + publish (JWT-guarded, owner-scoped in the service)
  // ---------------------------------------------------------------------------

  /** Create a draft drop on an owned, eligible track (#482). */
  @UseGuards(AuthGuard("jwt"))
  @Post("drops")
  createDraft(
    @Req() req: any,
    @Body()
    body: { trackId?: string; title?: string | null; description?: string | null },
  ) {
    return this.dropService.createDraft(req.user.userId, {
      trackId: body?.trackId as string,
      title: body?.title,
      description: body?.description,
    });
  }

  /** Update a draft drop's metadata. */
  @UseGuards(AuthGuard("jwt"))
  @Patch("drops/:dropId")
  updateDraft(
    @Req() req: any,
    @Param("dropId") dropId: string,
    @Body() body: { title?: string | null; description?: string | null },
  ) {
    return this.dropService.updateDraft(req.user.userId, dropId, {
      title: body?.title,
      description: body?.description,
    });
  }

  /** Add a collectible moment to a draft drop. */
  @UseGuards(AuthGuard("jwt"))
  @Post("drops/:dropId/moments")
  addMoment(
    @Req() req: any,
    @Param("dropId") dropId: string,
    @Body()
    body: {
      title?: string;
      lyricText?: string;
      artworkUrl?: string | null;
      startMs?: number;
      endMs?: number;
      editionSize?: number;
      priceCents?: number;
    },
  ) {
    return this.dropService.addMoment(req.user.userId, dropId, {
      title: body?.title,
      lyricText: body?.lyricText,
      artworkUrl: body?.artworkUrl,
      startMs: body?.startMs,
      endMs: body?.endMs,
      editionSize: body?.editionSize,
      priceCents: body?.priceCents,
    });
  }

  /** Edit a moment on a draft drop. */
  @UseGuards(AuthGuard("jwt"))
  @Patch("drops/:dropId/moments/:momentId")
  updateMoment(
    @Req() req: any,
    @Param("dropId") dropId: string,
    @Param("momentId") momentId: string,
    @Body()
    body: {
      title?: string;
      lyricText?: string;
      artworkUrl?: string | null;
      startMs?: number;
      endMs?: number;
      editionSize?: number;
      priceCents?: number;
    },
  ) {
    return this.dropService.updateMoment(req.user.userId, dropId, momentId, {
      title: body?.title,
      lyricText: body?.lyricText,
      artworkUrl: body?.artworkUrl,
      startMs: body?.startMs,
      endMs: body?.endMs,
      editionSize: body?.editionSize,
      priceCents: body?.priceCents,
    });
  }

  /** Remove a moment from a draft drop. */
  @UseGuards(AuthGuard("jwt"))
  @Delete("drops/:dropId/moments/:momentId")
  removeMoment(
    @Req() req: any,
    @Param("dropId") dropId: string,
    @Param("momentId") momentId: string,
  ) {
    return this.dropService.removeMoment(req.user.userId, dropId, momentId);
  }

  /** Publish a draft: re-run the gate, extract each clip, persist, emit event. */
  @UseGuards(AuthGuard("jwt"))
  @Post("drops/:dropId/publish")
  publish(@Req() req: any, @Param("dropId") dropId: string) {
    return this.dropService.publish(req.user.userId, dropId);
  }

  /**
   * Owner-scoped list of the caller's drops (any status) on a track (#484).
   * Powers the release-panel drop builder's resume flow — the newest draft can
   * be resumed and published drops shown as summaries. Path is under `me/` so it
   * never collides with the public `GET /punchline/drops/:dropId` route.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get("me/track-drops")
  listMyTrackDrops(@Req() req: any, @Query("trackId") trackId?: string) {
    if (!trackId) {
      throw new BadRequestException("trackId query parameter is required");
    }
    return this.dropService.listDropsForTrackOwner(req.user.userId, trackId);
  }

  // ---------------------------------------------------------------------------
  // Complete-set unlock (#488)
  // ---------------------------------------------------------------------------

  /**
   * Create/replace the drop's single complete_set bonus (owner + draft only):
   * a bonus vocal clip range + optional note, extracted at publish time.
   */
  @UseGuards(AuthGuard("jwt"))
  @Put("drops/:dropId/unlock")
  setDropUnlock(
    @Req() req: any,
    @Param("dropId") dropId: string,
    @Body() body: SetDropUnlockInput,
  ) {
    return this.unlockService.setDropUnlock(req.user.userId, dropId, body ?? {});
  }

  /** Remove the drop's set bonus (owner + draft only). */
  @UseGuards(AuthGuard("jwt"))
  @Delete("drops/:dropId/unlock")
  removeDropUnlock(@Req() req: any, @Param("dropId") dropId: string) {
    return this.unlockService.removeDropUnlock(req.user.userId, dropId);
  }

  /**
   * Owner-only funnel metrics for one drop (#489): views → previews →
   * collect starts (analytics facts) joined with collected editions and set
   * completions (DB truth), per drop and per moment.
   */
  @UseGuards(AuthGuard("jwt"))
  @Get("me/drops/:dropId/metrics")
  getDropMetrics(@Req() req: any, @Param("dropId") dropId: string) {
    return this.metricsService.getDropMetrics(req.user.userId, dropId);
  }

  /** The caller's granted set rewards, revealed — collector reward state. */
  @UseGuards(AuthGuard("jwt"))
  @Get("me/unlocks")
  listMyUnlocks(@Req() req: any) {
    return this.unlockService.listMyUnlocks(req.user.userId);
  }

  // ---------------------------------------------------------------------------
  // Collect + ownership (#485)
  // ---------------------------------------------------------------------------

  /**
   * Collect one edition of a published moment (#485). Free moments grant
   * immediately (rail "free_claim"); priced moments are rejected here with
   * `payment_required` and must go through the paid x402 checkout below.
   * Edition scarcity and the one-per-fan cap are DB-enforced.
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("moments/:momentId/collect")
  collectMoment(
    @Req() req: any,
    @Param("momentId") momentId: string,
    @Body() body?: { collectorWallet?: string | null },
  ) {
    return this.collectService.collectMoment(req.user.userId, momentId, {
      collectorWallet: body?.collectorWallet ?? null,
    });
  }

  /**
   * Public x402 quote for a priced moment (#1462): the USD amount, 15% personal
   * take breakdown, USDC asset, and payout address the fan's passkey wallet
   * pays. Honest 4xx for free / sold-out / not-published moments.
   */
  @Get("moments/:momentId/collect/quote")
  getCollectQuote(@Param("momentId") momentId: string) {
    return this.x402Service.buildMomentQuote(momentId);
  }

  /**
   * Paid collect (#1462): the fan's Resonate passkey wallet has already sent
   * USDC to the payout address; this verifies the on-chain payment, grants the
   * edition, and records the settlement in one transaction. Re-posting the same
   * txHash is idempotent. A verified-but-unfulfillable payment returns
   * `paid_but_unfulfilled` (support refund; no edition granted).
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("moments/:momentId/collect/smart-account")
  collectMomentWithSmartAccount(
    @Req() req: any,
    @Param("momentId") momentId: string,
    @Body() body: { txHash?: string; payer?: string; collectorWallet?: string | null },
  ) {
    return this.x402Service.collectWithSmartAccount(req.user.userId, momentId, body ?? {});
  }

  /** The caller's owned collectibles — the inventory read (#485/#487). */
  @UseGuards(AuthGuard("jwt"))
  @Get("me/collectibles")
  listMyCollectibles(@Req() req: any) {
    return this.collectService.listMyCollectibles(req.user.userId);
  }

  // ---------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------

  /**
   * Drop detail. Uses OptionalJwtAuthGuard so a signed-in owner can preview
   * their own draft, while published/archived drops are visible to anyone.
   * Draft drops are hidden (404) from anonymous or non-owner callers.
   */
  @UseGuards(OptionalJwtAuthGuard)
  @Get("drops/:dropId")
  getDrop(@Req() req: any, @Param("dropId") dropId: string) {
    return this.dropService.getDropDetail(dropId, req.user?.userId);
  }

  /**
   * Public single-moment share payload (#1477 slice 2): powers the moment
   * permalink and its server-rendered OG card. Published-drop moments only;
   * anything else 404s. No auth — this is a public share surface.
   */
  @Get("moments/:momentId/public")
  getPublicMoment(@Param("momentId") momentId: string) {
    return this.dropService.getPublicMomentShare(momentId);
  }

  /**
   * Public edition-pride share (#1477 slice 2): the moment card plus edition
   * number and collector display name — ONLY when the collector opted in
   * (public community profile + "show owned items"). Otherwise 404, so the
   * response never reveals that the edition or a private collector exists.
   */
  @Get("collectibles/:collectibleId/public")
  getPublicCollectible(@Param("collectibleId") collectibleId: string) {
    return this.dropService.getPublicCollectibleShare(collectibleId);
  }

  /** Public featured drops for the Home shelf (#1479) — momentum-ranked. */
  @Get("featured")
  listFeatured(@Query("limit") limit?: string) {
    const parsed =
      typeof limit === "string" && limit.trim().length > 0
        ? Number.parseInt(limit, 10)
        : undefined;
    return this.dropService.listFeaturedDrops({
      limit: Number.isFinite(parsed) ? (parsed as number) : undefined,
    });
  }

  /** Public list of published drops for a track. */
  @Get("tracks/:trackId/drops")
  listPublishedForTrack(
    @Param("trackId") trackId: string,
    @Query("limit") limit?: string,
  ) {
    const parsed =
      typeof limit === "string" && limit.trim().length > 0
        ? Number.parseInt(limit, 10)
        : undefined;
    return this.dropService.listPublishedDropsForTrack(trackId, {
      limit: Number.isFinite(parsed) ? (parsed as number) : undefined,
    });
  }
}
