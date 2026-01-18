import { Injectable } from "@nestjs/common";
import { WalletAccount, WalletProvider } from "../wallet_provider";

@Injectable()
export class LocalWalletProvider implements WalletProvider {
  getAccount(userId: string): WalletAccount {
    return {
      address: `wallet_${userId}`,
      chainId: 0,
      accountType: "local",
      provider: "local",
    };
  }
}
