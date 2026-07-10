import { Module } from "@nestjs/common";
import { RightsModule } from "../rights/rights.module";
import { PunchlineController } from "./punchline.controller";
import { PunchlineEligibilityService } from "./punchline-eligibility.service";

/**
 * Punchline Drops (#480). Leaf module: it consumes the shared upload-rights
 * engine (via RightsModule) for the catalog-trust gate and exposes only the
 * eligibility check. Create/publish APIs land in #482.
 */
@Module({
  imports: [RightsModule],
  controllers: [PunchlineController],
  providers: [PunchlineEligibilityService],
  exports: [PunchlineEligibilityService],
})
export class PunchlineModule {}
