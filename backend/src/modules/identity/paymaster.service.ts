import { Injectable } from "@nestjs/common";
import { UserOperation } from "./erc4337/erc4337_client";
import { normalizeUserId } from "./user_id";

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
      spentUsd: userId ? this.sponsorSpentUsd.get(normalizeUserId(userId)) ?? 0 : undefined,
    };
  }

  resetUser(userId: string) {
    this.sponsorSpentUsd.delete(normalizeUserId(userId));
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
      const key = normalizeUserId(userId);
      const spent = this.sponsorSpentUsd.get(key) ?? 0;
      if (spent + spendUsd > this.sponsorMaxUsd) {
        return "0x";
      }
      this.sponsorSpentUsd.set(key, spent + spendUsd);
    }
    return this.paymasterAddress;
  }
}
