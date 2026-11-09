import { Module } from "@nestjs/common";
import { StemPricingController } from "./stem-pricing.controller";
import { StemPricingService } from "./stem-pricing.service";
import { X402Module } from "../x402/x402.module";

@Module({
  imports: [X402Module],
  controllers: [StemPricingController],
  providers: [StemPricingService],
  exports: [StemPricingService],
})
export class StemPricingModule {}
