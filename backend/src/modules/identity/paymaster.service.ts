import { Injectable } from "@nestjs/common";
import { UserOperation } from "./erc4337/erc4337_client";

@Injectable()
export class PaymasterService {
  private sponsorMaxUsd = Number(process.env.AA_SPONSOR_MAX_USD ?? 5);
  // If AA_PAYMASTER is not set, we don't use a paymaster (self-funded)
  private paymasterAddress: string | undefined = process.env.AA_PAYMASTER;
  private sponsorSpentUsd = new Map<string, number>();

  configure(input: { sponsorMaxUsd: number; paymasterAddress: string }) {
    this.sponsorMaxUsd = input.sponsorMaxUsd;
    this.paymasterAddress = input.paymasterAddress;
  }

  getStatus(userId?: string) {
    return {
      sponsorMaxUsd: this.sponsorMaxUsd,
      paymasterAddress: this.paymasterAddress,
      spentUsd: userId ? this.sponsorSpentUsd.get(userId) ?? 0 : undefined,
    };
  }

  resetUser(userId: string) {
    this.sponsorSpentUsd.delete(userId);
  }

  buildPaymasterData(userOp: UserOperation, spendUsd: number, userId?: string) {
    // If no paymaster is configured, return empty (self-funded)
    if (!this.paymasterAddress) {
      return "0x";
    }
    if (spendUsd > this.sponsorMaxUsd) {
      return "0x";
    }
    if (userId) {
      const spent = this.sponsorSpentUsd.get(userId) ?? 0;
      if (spent + spendUsd > this.sponsorMaxUsd) {
        return "0x";
      }
      this.sponsorSpentUsd.set(userId, spent + spendUsd);
    }
    return this.paymasterAddress;
  }
}
