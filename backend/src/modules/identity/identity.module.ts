import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventBus } from "../shared/event_bus";
import { Erc4337Client } from "./erc4337/erc4337_client";
import { SessionKeyService } from "./session_key.service";
import { SocialRecoveryService } from "./social_recovery.service";
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
    SessionKeyService,
    SocialRecoveryService,
    LocalWalletProvider,
    Erc4337WalletProvider,
    WalletProviderRegistry,
    PaymasterService,
    {
      provide: Erc4337Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const bundler = config.get<string>("AA_BUNDLER") || "http://localhost:4337";
        const entryPoint = config.get<string>("AA_ENTRY_POINT") || "0xEntryPoint";
        return new Erc4337Client(bundler, entryPoint);
      },
    },
  ],
  exports: [WalletService],
})
export class IdentityModule { }
