import { Module } from "@nestjs/common";
import { TrustService } from "./trust.service";
import { TrustController } from "./trust.controller";
import { PayoutEligibilityService } from "./payout-eligibility.service";

@Module({
  providers: [TrustService, PayoutEligibilityService],
  controllers: [TrustController],
  exports: [TrustService, PayoutEligibilityService],
})
export class TrustModule {}
