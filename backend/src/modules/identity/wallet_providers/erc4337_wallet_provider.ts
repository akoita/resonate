import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { WalletAccount, WalletProvider } from "../wallet_provider";

@Injectable()
export class Erc4337WalletProvider implements WalletProvider {
  private readonly chainId = Number(process.env.AA_CHAIN_ID ?? 8453);
  private readonly entryPoint = process.env.AA_ENTRY_POINT ?? "0xEntryPoint";
  private readonly factory = process.env.AA_FACTORY ?? "0xFactory";
  private readonly paymaster = process.env.AA_PAYMASTER ?? undefined;
  private readonly bundler = process.env.AA_BUNDLER ?? undefined;

  getAccount(userId: string): WalletAccount {
    const salt = process.env.AA_SALT ?? "resonate";
    const seed = `${userId}:${this.factory}:${this.entryPoint}:${salt}`;
    const address = `0x${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
    return {
      address,
      chainId: this.chainId,
      accountType: "erc4337",
      provider: "erc4337",
      entryPoint: this.entryPoint,
      factory: this.factory,
      paymaster: this.paymaster,
      bundler: this.bundler,
      salt,
    };
  }
}
