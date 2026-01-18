import { Injectable } from "@nestjs/common";
import { UserOperation } from "./erc4337/erc4337_client";

@Injectable()
export class PaymasterService {
  private sponsorMaxUsd = Number(process.env.AA_SPONSOR_MAX_USD ?? 5);
  private paymasterAddress = process.env.AA_PAYMASTER ?? "0xPaymaster";

  configure(input: { sponsorMaxUsd: number; paymasterAddress: string }) {
    this.sponsorMaxUsd = input.sponsorMaxUsd;
    this.paymasterAddress = input.paymasterAddress;
  }

  buildPaymasterData(userOp: UserOperation, spendUsd: number) {
    if (spendUsd > this.sponsorMaxUsd) {
      return "0x";
    }
    return this.paymasterAddress;
  }
}
