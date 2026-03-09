import { Controller, Get, Param, Post, UseGuards, Logger } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TrustService } from "./trust.service";

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
    return {
      artistId: trust.artistId,
      tier: trust.tier,
      stakeAmountWei: trust.stakeAmountWei,
      escrowDays: trust.escrowDays,
      totalUploads: trust.totalUploads,
      cleanHistory: trust.cleanHistory,
      disputesLost: trust.disputesLost,
    };
  }

  /**
   * POST /api/trust/:artistId/verify
   * Admin: manually set an artist as "verified" tier.
   */
  @Post(":artistId/verify")
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  async setVerified(@Param("artistId") artistId: string) {
    const trust = await this.trustService.setVerified(artistId);
    return { artistId: trust.artistId, tier: trust.tier };
  }
}
