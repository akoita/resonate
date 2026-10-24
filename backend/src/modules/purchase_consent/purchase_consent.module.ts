import { Module } from "@nestjs/common";
import { NotificationModule } from "../notifications/notification.module";
import { PurchaseConsentController } from "./purchase_consent.controller";
import { PurchaseConsentService } from "./purchase_consent.service";

/** Immediate-delivery consent for consumer digital purchases (#1776). */
@Module({
  imports: [NotificationModule],
  controllers: [PurchaseConsentController],
  providers: [PurchaseConsentService],
  exports: [PurchaseConsentService],
})
export class PurchaseConsentModule {}
