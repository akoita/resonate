import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";
import { WALLET_PROVIDER } from "./wallet_provider";
import { Erc4337WalletProvider } from "./wallet_providers/erc4337_wallet_provider";
import { LocalWalletProvider } from "./wallet_providers/local_wallet_provider";

@Module({
  controllers: [WalletController],
  providers: [
    EventBus,
    WalletService,
    {
      provide: WALLET_PROVIDER,
      useFactory: () => {
        const provider = process.env.WALLET_PROVIDER ?? "local";
        return provider === "erc4337"
          ? new Erc4337WalletProvider()
          : new LocalWalletProvider();
      },
    },
  ],
  exports: [WalletService],
})
export class IdentityModule {}
