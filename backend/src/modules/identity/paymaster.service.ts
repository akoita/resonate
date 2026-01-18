import { Injectable } from "@nestjs/common";
import { UserOperation } from "./erc4337/erc4337_client";

@Injectable()
export class PaymasterService {
  private sponsorMaxUsd = Number(process.env.AA_SPONSOR_MAX_USD ?? 5);
  private paymasterAddress = process.env.AA_PAYMASTER ?? "0xPaymaster";
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
