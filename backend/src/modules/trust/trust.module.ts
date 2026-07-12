import { Module } from "@nestjs/common";
import { RightsModule } from "../rights/rights.module";
import { TrustService } from "./trust.service";
import { TrustController } from "./trust.controller";
import { PayoutEligibilityService } from "./payout-eligibility.service";

@Module({
  // PayoutEligibilityService injects UploadRightsRoutingService (#1498).
  imports: [RightsModule],
  providers: [TrustService, PayoutEligibilityService],
  controllers: [TrustController],
  exports: [TrustService, PayoutEligibilityService],
})
export class TrustModule {}
