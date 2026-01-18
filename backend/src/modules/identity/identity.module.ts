import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";
import { Erc4337WalletProvider } from "./wallet_providers/erc4337_wallet_provider";
import { LocalWalletProvider } from "./wallet_providers/local_wallet_provider";
import { WalletProviderRegistry } from "./wallet_provider_registry";

@Module({
  controllers: [WalletController],
  providers: [
    EventBus,
    WalletService,
    LocalWalletProvider,
    Erc4337WalletProvider,
    WalletProviderRegistry,
  ],
  exports: [WalletService],
})
export class IdentityModule {}
