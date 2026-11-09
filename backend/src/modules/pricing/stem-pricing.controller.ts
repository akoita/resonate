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
import { StemPricingService } from "./stem-pricing.service";
import { X402Config } from "../x402/x402.config";
import { buildStemSaleSplit } from "./stem-sale-split";
import {
  BatchStemPricingBodyDto,
  BatchUpsertStemPricingBodyDto,
  StemPricingBodyDto,
} from "./stem-pricing.dto";

@Controller("api/stem-pricing")
export class StemPricingController {
  constructor(
    private readonly pricingService: StemPricingService,
    private readonly x402Config: X402Config,
  ) {}

  /**
   * GET /api/stem-pricing/split
   * The split of a source stem sale per licence tier, from the configured
   * take-rates (public, no auth). The single source for any UI that shows an
   * artist what they keep (#2599).
   */
  @Get("split")
  getSaleSplit() {
    return buildStemSaleSplit(this.x402Config.licensePricing);
  }

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
    @Body() dto: StemPricingBodyDto,
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
    @Body() body: BatchStemPricingBodyDto,
    @Req() req: { user: { userId: string } },
  ) {
    const { releaseId, source, ...dto } = body;
    return this.pricingService.batchUpdateByRelease(
      releaseId,
      req.user.userId,
      dto,
      source,
    );
  }

  /**
   * POST /api/stem-pricing/batch-upsert
   * Per-stem pricing: bulk-set distinct pricing for each stem in a release (owner-only)
   */
  @UseGuards(AuthGuard("jwt"))
  @Post("batch-upsert")
  batchUpsertByMap(
    @Body() body: BatchUpsertStemPricingBodyDto,
    @Req() req: { user: { userId: string } },
  ) {
    return this.pricingService.batchUpsertByMap(
      body.releaseId,
      req.user.userId,
      body.pricingMap,
    );
  }
}
