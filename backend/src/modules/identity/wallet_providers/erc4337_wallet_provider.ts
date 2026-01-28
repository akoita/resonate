import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { WalletAccount, WalletProvider } from "../wallet_provider";

@Injectable()
export class Erc4337WalletProvider implements WalletProvider {
  private readonly chainId = Number(process.env.AA_CHAIN_ID ?? 31337);
  // ERC-4337 v0.6 canonical entry point
  private readonly entryPoint =
    process.env.AA_ENTRY_POINT ?? "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
  // Default factory - should be deployed locally or use a testnet factory
  private readonly factory =
    process.env.AA_FACTORY ?? "0x9406Cc6185a346906296840746125a0E44976454";
  private readonly paymaster = process.env.AA_PAYMASTER ?? undefined;
  private readonly bundler = process.env.AA_BUNDLER ?? "http://localhost:4337";

  getAccount(userId: string): WalletAccount {
    const salt = process.env.AA_SALT ?? "resonate";
    const seed = `${userId}:${this.factory}:${this.entryPoint}:${salt}`;
    const address = `0x${createHash("sha256").update(seed).digest("hex").slice(0, 40)}`;
    return {
      address,
      chainId: this.chainId,
      accountType: "erc4337",
      provider: "erc4337",
      ownerAddress: userId,
      entryPoint: this.entryPoint,
      factory: this.factory,
      paymaster: this.paymaster,
      bundler: this.bundler,
      salt,
    };
  }
}
