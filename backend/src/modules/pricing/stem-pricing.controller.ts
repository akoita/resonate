import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { StemPricingService, StemPricingDto } from "./stem-pricing.service";

@Controller("api/stem-pricing")
export class StemPricingController {
  constructor(private readonly pricingService: StemPricingService) {}

  /**
   * GET /api/stem-pricing/templates
   * Returns available quick-pick pricing templates
   */
  @Get("templates")
  getTemplates() {
    return this.pricingService.getTemplates();
  }

  /**
   * GET /api/stem-pricing/batch-get?stemIds=id1,id2,...
   * Returns pricing for multiple stems in one call (public, no auth).
   * Used by marketplace to display license badges without N+1 requests.
   */
  @Get("batch-get")
  batchGetPricing(@Query("stemIds") stemIds: string) {
    const ids = stemIds ? stemIds.split(",").filter(Boolean).slice(0, 100) : [];
    return this.pricingService.batchGetPricing(ids);
  }

  /**
   * GET /api/stem-pricing/:stemId
   * Returns pricing config (or defaults) for a stem
   */
  @Get(":stemId")
  getPricing(@Param("stemId") stemId: string) {
    return this.pricingService.getPricing(stemId);
  }

  /**
   * PUT /api/stem-pricing/:stemId
   * Upsert pricing for a stem (owner-only)
   */
  @UseGuards(AuthGuard("jwt"))
  @Put(":stemId")
  upsertPricing(
    @Param("stemId") stemId: string,
    @Body() dto: StemPricingDto,
    @Req() req: { user: { userId: string } },
  ) {
    return this.pricingService.upsertPricing(stemId, req.user.userId, dto);
  }

  /**
   * POST /api/stem-pricing/batch
   * Bulk-set pricing for all stems of a release (owner-only)
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("batch")
  batchUpdate(
    @Body() body: { releaseId: string } & StemPricingDto,
    @Req() req: { user: { userId: string } },
  ) {
    const { releaseId, ...dto } = body;
    return this.pricingService.batchUpdateByRelease(
      releaseId,
      req.user.userId,
      dto,
    );
  }
}
