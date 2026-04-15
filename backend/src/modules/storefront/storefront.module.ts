import { Module } from "@nestjs/common";
import { StorefrontController } from "./storefront.controller";
import { StorefrontService } from "./storefront.service";
import { X402Module } from "../x402/x402.module";

@Module({
  imports: [X402Module],
  controllers: [StorefrontController],
  providers: [StorefrontService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
