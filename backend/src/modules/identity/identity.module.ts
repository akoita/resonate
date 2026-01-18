import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
  controllers: [WalletController],
  providers: [EventBus, WalletService],
  exports: [WalletService],
})
export class IdentityModule {}
