import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";
import {
  compareRouteSeverity,
  getUploadRightsActions,
  UPLOAD_RIGHTS_ROUTES,
  type UploadRightsActionProfile,
  type UploadRightsRoute,
} from "../rights/upload-rights-policy";
import {
  evaluatePayoutEligibility,
  type PayoutEligibilityReason,
  type PayoutEligibilityReasonCode,
  type PayoutEligibilityResult,
} from "../rights/payout-eligibility.policy";

/**
 * Reason codes surfaced by the service. Extends the pure policy's codes with
 * `artist_profile_required`, which is a pre-policy condition (the caller has no
 * artist profile to evaluate) rather than one of the four payout rules.
 */
export type ServicePayoutReasonCode =
  | PayoutEligibilityReasonCode
  | "artist_profile_required";

export interface ServicePayoutReason {
  code: ServicePayoutReasonCode;
  message: string;
  resolution: string;
}
import {
  deriveCreatorVerificationStates,
  type HumanVerificationState,
  type RightsReviewState,
} from "./verification-semantics";

/**
 * Where a payout-eligibility check is being enforced. Surfaces in the thrown
 * error and logs so an operator can tell a blocked Shows beneficiary from a
 * blocked marketplace mint.
 */
export type PayoutEligibilityContext =
  | "shows_beneficiary"
  | "marketplace_mint";

/**
 * Maps an upload-rights route to the rights-review state it represents for
 * payout purposes. STANDARD_ESCROW/TRUSTED_FAST_PATH are the routes the rights
 * engine grants once a release is approved (with limits / verified), so they
 * are the inverse of `approved_with_limits` / `rights_verified`. Every other
 * route is not payout-approved.
 */
const ROUTE_TO_RIGHTS_REVIEW_STATE: Record<UploadRightsRoute, RightsReviewState> =
  {
    TRUSTED_FAST_PATH: "rights_verified",
    STANDARD_ESCROW: "approved_with_limits",
    LIMITED_MONITORING: "under_review",
    QUARANTINED_REVIEW: "under_review",
    BLOCKED: "disputed",
  };

/** Inputs the policy was evaluated against — returned for honest UI display. */
export interface PayoutEligibilityInputsUsed {
  humanVerificationState: HumanVerificationState;
  rightsReviewState: RightsReviewState;
  payoutRelease: UploadRightsActionProfile["payoutRelease"];
  rightsFlags: string[];
  /** Most-permissive route the artist has a release under, or null if none. */
  rightsRoute: UploadRightsRoute | null;
  /** Whether the artist has any release at all. */
  hasReleases: boolean;
}

export interface ArtistPayoutEligibility extends PayoutEligibilityResult {
  artistId: string;
  inputs: PayoutEligibilityInputsUsed;
}

/**
 * Self-serve result for a user who may or may not have an artist profile. A
 * user with no artist gets a 200-shaped `eligible:false` with an
 * `artist_profile_required` reason — never a 404 — so the client always has an
 * honest, actionable answer.
 */
export interface UserPayoutEligibility {
  artistId: string | null;
  eligible: boolean;
  reasons: ServicePayoutReason[];
  inputs: PayoutEligibilityInputsUsed | null;
}

type ReleaseRightsSnapshot = {
  route: UploadRightsRoute | null;
  flags: string[];
};

@Injectable()
export class PayoutEligibilityService {
  constructor(
    private readonly rightsRouting: UploadRightsRoutingService = new UploadRightsRoutingService(),
  ) {}

  /**
   * Self-serve payout eligibility for a user id (from the caller's JWT).
   * Resolves the caller's artist profile; a user with no artist gets an
   * `artist_profile_required` reason instead of a 404.
   */
  async checkForUser(userId: string): Promise<UserPayoutEligibility> {
    const artist = await prisma.artist.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!artist) {
      return {
        artistId: null,
        eligible: false,
        reasons: [
          {
            code: "artist_profile_required",
            message:
              "You do not have an artist profile yet, so payouts cannot be enabled.",
            resolution:
              "Create your artist profile (artist onboarding) and set a payout address before opening a paid campaign or listing.",
          },
        ],
        inputs: null,
      };
    }
    return this.checkForArtist(artist.id);
  }

  /**
   * Explainable payout eligibility for an artist. Loads the human-verification
   * record and the artist's releases, evaluates the fail-closed policy over the
   * most-permissive eligible release, and returns both the decision and the
   * exact inputs it used so the UI never has to re-derive policy.
   */
  async checkForArtist(artistId: string): Promise<ArtistPayoutEligibility> {
    const humanVerificationState = await this.resolveHumanVerificationState(
      artistId,
    );
    const releases = await this.loadReleaseRightsSnapshots(artistId);

    // No release ⇒ no route can carry a payout. Report rights-review-required
    // as the primary, actionable reason (plus human verification when missing).
    if (releases.length === 0) {
      const inputs: PayoutEligibilityInputsUsed = {
        humanVerificationState,
        rightsReviewState: "not_reviewed",
        payoutRelease: "held",
        rightsFlags: [],
        rightsRoute: null,
        hasReleases: false,
      };
      const result = evaluatePayoutEligibility(inputs);
      return { artistId, ...result, inputs };
    }

    // Evaluate every release; the artist is eligible if ANY release qualifies.
    // Otherwise report the most-permissive route's reasons (the closest one to
    // being payable), which is also the honest "here's your best path" view.
    let best: {
      snapshot: ReleaseRightsSnapshot;
      inputs: PayoutEligibilityInputsUsed;
      result: PayoutEligibilityResult;
    } | null = null;

    for (const snapshot of releases) {
      const inputs = this.buildInputs(humanVerificationState, snapshot);
      const result = evaluatePayoutEligibility(inputs);
      if (result.eligible) {
        return { artistId, ...result, inputs };
      }
      if (!best || this.isMorePermissive(snapshot.route, best.snapshot.route)) {
        best = { snapshot, inputs, result };
      }
    }

    return { artistId, ...best!.result, inputs: best!.inputs };
  }

  /**
   * Fail-closed assertion used at money-bearing seams. Throws a 403 with the
   * full explainable reason list so the client can render the same
   * "why + how to fix" the self-serve endpoint returns.
   */
  async assertEligible(
    artistId: string,
    context: PayoutEligibilityContext,
  ): Promise<void> {
    const eligibility = await this.checkForArtist(artistId);
    if (!eligibility.eligible) {
      throw new ForbiddenException({
        code: "payout_not_eligible",
        context,
        message:
          "This artist is not eligible to receive payouts yet. Resolve the listed steps and try again.",
        reasons: eligibility.reasons,
      });
    }
  }

  private buildInputs(
    humanVerificationState: HumanVerificationState,
    snapshot: ReleaseRightsSnapshot,
  ): PayoutEligibilityInputsUsed {
    const actions: UploadRightsActionProfile | null = snapshot.route
      ? getUploadRightsActions(snapshot.route)
      : null;
    return {
      humanVerificationState,
      rightsReviewState: snapshot.route
        ? ROUTE_TO_RIGHTS_REVIEW_STATE[snapshot.route]
        : "not_reviewed",
      payoutRelease: actions?.payoutRelease ?? "none",
      rightsFlags: snapshot.flags,
      rightsRoute: snapshot.route,
      hasReleases: true,
    };
  }

  private isMorePermissive(
    candidate: UploadRightsRoute | null,
    current: UploadRightsRoute | null,
  ): boolean {
    if (!candidate) return false;
    if (!current) return true;
    // compareRouteSeverity < 0 ⇒ candidate is less severe (more permissive).
    return compareRouteSeverity(candidate, current) < 0;
  }

  private async resolveHumanVerificationState(
    artistId: string,
  ): Promise<HumanVerificationState> {
    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { userId: true },
    });
    if (!artist?.userId) {
      return "unverified";
    }
    const record = await prisma.curatorReputation.findUnique({
      where: { walletAddress: artist.userId.toLowerCase() },
      select: { humanVerificationStatus: true, humanVerifiedAt: true },
    });
    return deriveCreatorVerificationStates({
      humanVerificationStatus: record?.humanVerificationStatus,
      humanVerifiedAt: record?.humanVerifiedAt ?? null,
    }).humanVerificationStatus;
  }

  private async loadReleaseRightsSnapshots(
    artistId: string,
  ): Promise<ReleaseRightsSnapshot[]> {
    const releases = await prisma.release.findMany({
      where: { artistId },
      select: { rightsRoute: true, rightsFlags: true },
    });
    return releases.map((release) => ({
      route: this.parseRoute(release.rightsRoute),
      flags: this.parseFlags(release.rightsFlags),
    }));
  }

  private parseRoute(value?: string | null): UploadRightsRoute | null {
    const normalized = value?.trim().toUpperCase();
    if (
      normalized &&
      (UPLOAD_RIGHTS_ROUTES as readonly string[]).includes(normalized)
    ) {
      return normalized as UploadRightsRoute;
    }
    return null;
  }

  private parseFlags(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((entry): entry is string => typeof entry === "string");
  }
}

export type { PayoutEligibilityReason };
