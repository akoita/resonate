import { Module, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Erc4337Client } from "./erc4337/erc4337_client";
import { KernelAccountService } from "./kernel_account.service";
import { SessionKeyService } from "./session_key.service";
import { ZeroDevSessionKeyService } from "./zerodev_session_key.service";
import { SocialRecoveryService } from "./social_recovery.service";
import { PaymasterService } from "./paymaster.service";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";
import { Erc4337WalletProvider } from "./wallet_providers/erc4337_wallet_provider";
import { LocalWalletProvider } from "./wallet_providers/local_wallet_provider";
import { WalletProviderRegistry } from "./wallet_provider_registry";
import { AuthModule } from "../auth/auth.module";
import { SharedModule } from "../shared/shared.module";
import { AgentsModule } from "../agents/agents.module";

@Module({
  imports: [SharedModule, forwardRef(() => AgentsModule)],
  controllers: [WalletController],
  providers: [
    WalletService,
    SessionKeyService,
    ZeroDevSessionKeyService,
    SocialRecoveryService,
    LocalWalletProvider,
    Erc4337WalletProvider,
    WalletProviderRegistry,
    PaymasterService,
    KernelAccountService,
    {
      provide: Erc4337Client,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const bundler = config.get<string>("AA_BUNDLER") || "http://localhost:4337";
        // ERC-4337 v0.6 canonical entry point
        const entryPoint =
          config.get<string>("AA_ENTRY_POINT") || "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
        return new Erc4337Client(bundler, entryPoint);
      },
    },
  ],
  exports: [
    WalletService,
    SessionKeyService,
    ZeroDevSessionKeyService,
    WalletProviderRegistry,
    PaymasterService,
    Erc4337Client,
    KernelAccountService,
  ],
})
export class IdentityModule { }
