import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { Erc4337Client } from "./erc4337/erc4337_client";
import { PaymasterService } from "./paymaster.service";
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
    PaymasterService,
    {
      provide: Erc4337Client,
      useFactory: () => {
        const bundler = process.env.AA_BUNDLER ?? "http://localhost:4337";
        const entryPoint = process.env.AA_ENTRY_POINT ?? "0xEntryPoint";
        return new Erc4337Client(bundler, entryPoint);
      },
    },
  ],
  exports: [WalletService],
})
export class IdentityModule {}
