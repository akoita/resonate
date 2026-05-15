import { Injectable } from "@nestjs/common";
import { AgentPurchaseInput, AgentPurchaseService } from "./agent_purchase.service";
import type { AgentLicenseType } from "./agent_runtime.types";
import {
  AgentPaymentRail,
  PolicyGuardService,
  type PolicyGuardResult,
} from "./policy_guard.service";

export interface PaymentRouterInput extends AgentPurchaseInput {
  rail?: AgentPaymentRail;
  licenseType?: AgentLicenseType;
  budgetRemainingUsd: number;
  allowedRails?: AgentPaymentRail[];
  allowedLicenseTypes?: AgentLicenseType[];
}

export interface PaymentRouterResult {
  success: boolean;
  rail: AgentPaymentRail;
  status: "confirmed" | "rejected" | "failed";
  reason?: string;
  message?: string;
  transactionId?: string;
  txHash?: string;
  remaining?: number;
  policy?: PolicyGuardResult;
}

@Injectable()
export class PaymentRouterService {
  constructor(
    private readonly policyGuard: PolicyGuardService,
    private readonly erc4337Rail: AgentPurchaseService,
  ) {}

  async purchase(input: PaymentRouterInput): Promise<PaymentRouterResult> {
    const rail = input.rail ?? "erc4337_marketplace";
    const licenseType = input.licenseType ?? "personal";
    const policy = this.policyGuard.evaluate({
      sessionId: input.sessionId,
      userId: input.userId,
      rail,
      licenseType,
      priceUsd: input.priceUsd,
      budgetRemainingUsd: input.budgetRemainingUsd,
      allowedRails: input.allowedRails,
      allowedLicenseTypes: input.allowedLicenseTypes,
    });

    if (!policy.allowed) {
      return {
        success: false,
        rail,
        status: "rejected",
        reason: policy.reason,
        remaining: policy.remainingUsd,
        policy,
      };
    }

    if (rail !== "erc4337_marketplace") {
      return {
        success: false,
        rail,
        status: "rejected",
        reason: "rail_not_implemented",
        remaining: policy.remainingUsd,
        policy,
      };
    }

    const result = await this.erc4337Rail.purchase(input);
    if (result.success) {
      return {
        success: true,
        rail,
        status: "confirmed",
        transactionId: result.transactionId,
        txHash: result.txHash,
        remaining: result.remaining,
        policy,
      };
    }

    return {
      success: false,
      rail,
      status: "failed",
      reason: result.reason,
      message: result.message,
      transactionId: result.transactionId,
      remaining: result.remaining ?? policy.remainingUsd,
      policy,
    };
  }
}
