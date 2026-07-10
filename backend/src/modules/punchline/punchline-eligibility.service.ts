import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";
import {
  PUNCHLINE_PUBLISHED_RELEASE_STATUSES,
  PUNCHLINE_RIGHTS_LABEL,
  PUNCHLINE_RIGHTS_SUMMARY,
  PUNCHLINE_SOURCE_STEM_TYPE,
} from "./punchline-rights";

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

/**
 * Punchline Drops eligibility + rights gate (#480).
 *
 * Explainable allow/deny for whether a track may become a Punchline Drop. Only
 * safe, publishable, artist-approved tracks with a usable vocal stem pass. The
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
  ) {}

  async checkEligibility(
    trackId: string,
  ): Promise<PunchlineEligibilityResult> {
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
          where: { type: PUNCHLINE_SOURCE_STEM_TYPE },
          select: { id: true, type: true, uri: true },
        },
      },
    });

    const base = {
      rightsLabel: PUNCHLINE_RIGHTS_LABEL,
      rightsSummary: PUNCHLINE_RIGHTS_SUMMARY,
    };

    if (!track) {
      return {
        ...base,
        eligible: false,
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

    // 2) A usable vocal stem must exist. "Available" = a `vocals` stem whose
    //    audio has been written (non-empty uri), i.e. stem separation finished.
    const hasVocalsStem = track.stems.some(
      (stem) => stem.type === PUNCHLINE_SOURCE_STEM_TYPE && !!stem.uri?.trim(),
    );
    if (!hasVocalsStem) {
      reasons.push({
        code: "no_vocals_stem",
        message:
          "No processed vocal stem is available for this track. Punchline Drops can only be created from the vocals stem.",
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
