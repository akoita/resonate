import { Controller, Get, Param, Post, UseGuards, Logger } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TrustService } from "./trust.service";
import { deriveCreatorVerificationStates } from "./verification-semantics";

@Controller("api/trust")
export class TrustController {
  private readonly logger = new Logger(TrustController.name);

  constructor(private readonly trustService: TrustService) {}

  /**
   * GET /api/trust/:artistId
   * Returns the trust tier and stake requirement for the given artist.
   */
  @Get(":artistId")
  @UseGuards(AuthGuard("jwt"))
  async getTrustTier(@Param("artistId") artistId: string) {
    const trust = await this.trustService.getStakeRequirement(artistId);
    const verification = deriveCreatorVerificationStates({
      economicTier: trust.tier,
    });

    return {
      artistId: trust.artistId,
      tier: trust.tier,
      economicTier: verification.economicTier,
      stakeAmountWei: trust.stakeAmountWei,
      escrowDays: trust.escrowDays,
      maxPriceMultiplier: trust.maxPriceMultiplier,
      maxListingPriceWei: trust.maxListingPriceWei,
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
   * Admin: manually set an artist to the "verified" trust tier.
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
