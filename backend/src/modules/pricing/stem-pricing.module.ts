import { Module } from "@nestjs/common";
import { StemPricingController } from "./stem-pricing.controller";
import { StemPricingService } from "./stem-pricing.service";

@Module({
  controllers: [StemPricingController],
  providers: [StemPricingService],
  exports: [StemPricingService],
})
export class StemPricingModule {}
