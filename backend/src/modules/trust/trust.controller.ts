import {
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
  Logger,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TrustService } from "./trust.service";
import { PayoutEligibilityService } from "./payout-eligibility.service";
import { deriveCreatorVerificationStates } from "./verification-semantics";

@Controller("api/trust")
export class TrustController {
  private readonly logger = new Logger(TrustController.name);

  constructor(
    private readonly trustService: TrustService,
    private readonly payoutEligibilityService: PayoutEligibilityService,
  ) {}

  /**
   * GET /api/trust/me/payout-eligibility
   * Self-serve, explainable payout eligibility for the authenticated caller's
   * artist profile (ADR-BM-5, #1498). Returns `eligible`, the full reason list
   * with resolutions, and the input states used — so the artist sees an honest
   * "why + how to fix". A caller with no artist profile gets a 200 with
   * `eligible:false` and an `artist_profile_required` reason (never a 404).
   */
  @Get("me/payout-eligibility")
  @UseGuards(AuthGuard("jwt"))
  async getMyPayoutEligibility(@Request() req: any) {
    return this.payoutEligibilityService.checkForUser(req.user.userId);
  }

  /**
   * GET /api/trust/:artistId
   * Returns the economic trust tier and stake requirement for the given artist.
   */
  @Get(":artistId")
  @UseGuards(AuthGuard("jwt"))
  async getTrustTier(@Param("artistId") artistId: string) {
    const [trust, creatorVerificationRecord] = await Promise.all([
      this.trustService.getStakeRequirement(artistId),
      this.trustService.getCreatorVerificationRecord(artistId),
    ]);
    const verification = deriveCreatorVerificationStates({
      economicTier: trust.tier,
      humanVerificationStatus: creatorVerificationRecord.humanVerificationStatus,
      humanVerifiedAt: creatorVerificationRecord.humanVerifiedAt,
    });

    return {
      artistId: trust.artistId,
      tier: trust.tier,
      economicTier: verification.economicTier,
      stakeAmountWei: trust.stakeAmountWei,
      stakeAmountUsd: trust.stakeAmountUsd,
      tierStakeAmountWei: trust.tierStakeAmountWei,
      tierStakeAmountUsd: trust.tierStakeAmountUsd,
      protocolMinimumStakeAmountWei: trust.protocolMinimumStakeAmountWei,
      protocolMinimumStakeAmountUsd: trust.protocolMinimumStakeAmountUsd,
      policySource: trust.policySource,
      escrowDays: trust.escrowDays,
      maxPriceMultiplier: trust.maxPriceMultiplier,
      maxListingPriceWei: trust.maxListingPriceWei,
      maxListingPriceUsd: trust.maxListingPriceUsd,
      maxListingPriceUncapped: trust.maxListingPriceUncapped,
      totalUploads: trust.totalUploads,
      cleanHistory: trust.cleanHistory,
      disputesLost: trust.disputesLost,
      humanVerificationStatus: verification.humanVerificationStatus,
      humanVerifiedAt: verification.humanVerifiedAt,
      platformReviewStatus: verification.platformReviewStatus,
    };
  }

  /**
   * POST /api/trust/:artistId/verify
   * Admin: manually set an artist to the "verified" economic tier.
   */
  @Post(":artistId/verify")
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  async setVerified(@Param("artistId") artistId: string) {
    const trust = await this.trustService.setVerified(artistId);
    const verification = deriveCreatorVerificationStates({
      economicTier: trust.tier,
    });

    return {
      artistId: trust.artistId,
      tier: trust.tier,
      economicTier: verification.economicTier,
      platformReviewStatus: verification.platformReviewStatus,
    };
  }
}
