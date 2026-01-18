import { Injectable } from "@nestjs/common";
type WalletProviderName = "local" | "erc4337";
import { Erc4337WalletProvider } from "./wallet_providers/erc4337_wallet_provider";
import { LocalWalletProvider } from "./wallet_providers/local_wallet_provider";

@Injectable()
export class WalletProviderRegistry {
  constructor(
    private readonly localProvider: LocalWalletProvider,
    private readonly erc4337Provider: Erc4337WalletProvider
  ) {}

  getProvider(name?: WalletProviderName) {
    if (name === "erc4337") {
      return this.erc4337Provider;
    }
    return this.localProvider;
  }
}
