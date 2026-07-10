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
import { PunchlineDropService } from "./punchline-drop.service";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";

@Controller("punchline")
export class PunchlineController {
  constructor(
    private readonly eligibilityService: PunchlineEligibilityService,
    private readonly dropService: PunchlineDropService,
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
