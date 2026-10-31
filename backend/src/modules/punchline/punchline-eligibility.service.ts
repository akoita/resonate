import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../../db/prisma";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";
import {
  PUNCHLINE_PUBLISHED_RELEASE_STATUSES,
  PUNCHLINE_RIGHTS_LABEL,
  PUNCHLINE_RIGHTS_SUMMARY,
  PUNCHLINE_SOURCE_STEM_TYPE,
} from "./punchline-rights";
import {
  PunchlineClipBounds,
  resolvePunchlineClipBounds,
  resolvePunchlineClipBoundsByLayer,
} from "./punchline-clip.config";
import {
  normalizeSourceLayer,
  resolvePunchlineSourceLayers,
  sourceLayerForStemType,
  sourceLayerLabel,
  stemTypesForSourceLayer,
} from "./punchline-source";

/**
 * A single, explainable failure reason. Every gate that denies a track adds one
 * with a stable machine `code` (safe for UI/analytics branching) plus a
 * human-readable `message`. Mirrors the remix-eligibility decision shape.
 */
export interface PunchlineEligibilityReason {
  code: PunchlineEligibilityReasonCode;
  message: string;
}

export type PunchlineEligibilityReasonCode =
  | "track_not_found"
  | "track_not_published"
  | "no_source_stem"
  /**
   * Legacy (pre-#1476) code for a missing vocals stem. No longer emitted; kept
   * in the union so stored or cached results still type-check.
   */
  | "no_vocals_stem"
  | "content_quarantined"
  | "content_removed"
  | "rights_not_allowed";

export interface PunchlineEligibilityResult {
  /** True only when no gate produced a reason. */
  eligible: boolean;
  reasons: PunchlineEligibilityReason[];
  /** Machine rights class every Punchline Drop is minted under. */
  rightsLabel: string;
  /** UI-safe human summary of that rights class. */
  rightsSummary: string;
  /**
   * Server-resolved clip length bounds (ms). The clip-selection UI reads these
   * so the client never hardcodes the min/max — the same env-tunable bounds the
   * extractor (#481) and publish validation (#482) enforce, so a range the UI
   * accepts is always publishable.
   */
  clipBoundsMs: PunchlineClipBounds;
  /**
   * Clip bounds per allowed source layer (#1476). A full-mix moment has a
   * tighter max than a stem moment.
   */
  clipBoundsMsByLayer: Record<string, PunchlineClipBounds>;
  /** Source layers the configured allowlist accepts. */
  allowedSourceLayers: string[];
  /** Allowed layers this track has processed audio for (empty if none). */
  availableSourceLayers: string[];
  /** The layer that was checked, when the caller asked for one. */
  sourceLayer?: string;
  /** Minimal source snapshot; omitted when the track does not exist. */
  track?: {
    id: string;
    releaseId: string;
    releaseStatus: string;
    contentStatus: string;
    rightsRoute: string | null;
    releaseRightsRoute: string | null;
    hasVocalsStem: boolean;
  };
}

export interface PunchlineEligibilityOptions {
  /**
   * Check one source layer. Omitted → the track passes if ANY allowed layer
   * has processed audio (the drop-level gate; each moment's layer is checked
   * at add and publish time).
   */
  sourceLayer?: string;
}

/**
 * Punchline Drops eligibility + rights gate (#480).
 *
 * Explainable allow/deny for whether a track may become a Punchline Drop. Only
 * safe, publishable, artist-approved tracks with a usable source layer pass
 * (any allowed stem or the full mix since #1476; vocals stays the default). The
 * later create/publish APIs (#482) re-run this server-side before mutating.
 *
 * The rights-route gate does NOT reinvent policy: it defers to
 * `UploadRightsRoutingService`, the same engine that decides whether a track's
 * catalog is trusted enough for marketplace actions. Unverified / low-trust
 * routes (LIMITED_MONITORING) and blocked/quarantined routes (BLOCKED,
 * QUARANTINED_REVIEW) all report `marketplaceAllowed: false` and are denied.
 */
@Injectable()
export class PunchlineEligibilityService {
  constructor(
    private readonly rightsRouting: UploadRightsRoutingService = new UploadRightsRoutingService(),
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async checkEligibility(
    trackId: string,
    options: PunchlineEligibilityOptions = {},
  ): Promise<PunchlineEligibilityResult> {
    const clipBoundsMs = resolvePunchlineClipBounds(this.configService);
    const allowedSourceLayers = resolvePunchlineSourceLayers(this.configService);
    const clipBoundsMsByLayer = resolvePunchlineClipBoundsByLayer(
      this.configService,
      allowedSourceLayers,
    );
    const requestedLayer =
      options.sourceLayer !== undefined
        ? normalizeSourceLayer(options.sourceLayer)
        : undefined;
    const candidateStemTypes = allowedSourceLayers.flatMap(
      stemTypesForSourceLayer,
    );
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        releaseId: true,
        contentStatus: true,
        rightsRoute: true,
        release: {
          select: {
            status: true,
            rightsRoute: true,
          },
        },
        stems: {
          where: { type: { in: candidateStemTypes }, isCurrent: true },
          select: { id: true, type: true, uri: true },
        },
      },
    });

    const base = {
      rightsLabel: PUNCHLINE_RIGHTS_LABEL,
      rightsSummary: PUNCHLINE_RIGHTS_SUMMARY,
      clipBoundsMs,
      clipBoundsMsByLayer,
      allowedSourceLayers,
      ...(requestedLayer !== undefined ? { sourceLayer: requestedLayer } : {}),
    };

    if (!track) {
      return {
        ...base,
        eligible: false,
        availableSourceLayers: [],
        reasons: [
          {
            code: "track_not_found",
            message: `Track ${trackId} was not found.`,
          },
        ],
      };
    }

    const reasons: PunchlineEligibilityReason[] = [];

    // 1) The release must be published (past processing) to be collectible.
    const releaseStatus = track.release?.status ?? "";
    if (
      !PUNCHLINE_PUBLISHED_RELEASE_STATUSES.includes(
        releaseStatus as (typeof PUNCHLINE_PUBLISHED_RELEASE_STATUSES)[number],
      )
    ) {
      reasons.push({
        code: "track_not_published",
        message:
          "The track's release is not published yet. Publish the release before creating a Punchline Drop.",
      });
    }

    // 2) A usable source layer must exist. "Available" = a current stem row of
    //    that layer whose audio has been written (non-empty uri), i.e. stem
    //    separation (or the upload, for the full mix) finished.
    const availableSet = new Set<string>();
    for (const stem of track.stems) {
      const layer = sourceLayerForStemType(stem.type);
      if (layer && allowedSourceLayers.includes(layer) && !!stem.uri?.trim()) {
        availableSet.add(layer);
      }
    }
    const availableSourceLayers = allowedSourceLayers.filter((layer) =>
      availableSet.has(layer),
    );
    const hasVocalsStem = availableSet.has(PUNCHLINE_SOURCE_STEM_TYPE);
    if (requestedLayer !== undefined) {
      if (!allowedSourceLayers.includes(requestedLayer)) {
        reasons.push({
          code: "no_source_stem",
          message: `"${requestedLayer}" is not an allowed source for a moment. Allowed sources: ${allowedSourceLayers.join(", ")}.`,
        });
      } else if (!availableSet.has(requestedLayer)) {
        reasons.push({
          code: "no_source_stem",
          message: `No processed ${sourceLayerLabel(requestedLayer)} is available for this track. Pick another source for this moment.`,
        });
      }
    } else if (availableSourceLayers.length === 0) {
      reasons.push({
        code: "no_source_stem",
        message: `No processed source audio is available for this track. Moments can be clipped from: ${allowedSourceLayers.map(sourceLayerLabel).join(", ")}.`,
      });
    }

    // 3) Content safety — a quarantined or DMCA-removed track can never drop.
    if (track.contentStatus === "quarantined") {
      reasons.push({
        code: "content_quarantined",
        message:
          "This track is quarantined pending rights review and cannot create a Punchline Drop.",
      });
    } else if (track.contentStatus === "dmca_removed") {
      reasons.push({
        code: "content_removed",
        message:
          "This track has been removed following a copyright claim and cannot create a Punchline Drop.",
      });
    }

    // 4) Rights route — defer to the upload-rights engine. Unverified /
    //    low-trust or blocked catalogs are not marketplace-eligible, so they
    //    cannot mint collectibles either.
    const { actions } = this.rightsRouting.getPublicationActionsForRoutes(
      track.rightsRoute,
      track.release?.rightsRoute,
    );
    if (actions && !actions.marketplaceAllowed) {
      reasons.push({
        code: "rights_not_allowed",
        message:
          "This track's catalog rights are not verified for publication. Punchline Drops require a trusted or standard rights route.",
      });
    }

    return {
      ...base,
      eligible: reasons.length === 0,
      reasons,
      availableSourceLayers,
      track: {
        id: track.id,
        releaseId: track.releaseId,
        releaseStatus,
        contentStatus: track.contentStatus,
        rightsRoute: track.rightsRoute ?? null,
        releaseRightsRoute: track.release?.rightsRoute ?? null,
        hasVocalsStem,
      },
    };
  }
}
