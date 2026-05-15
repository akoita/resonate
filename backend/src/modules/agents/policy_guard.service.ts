import { Injectable } from "@nestjs/common";
import type { AgentLicenseType } from "./agent_runtime.types";

export type AgentPaymentRail = "erc4337_marketplace" | "x402";

export interface PolicyGuardInput {
  sessionId: string;
  userId: string;
  rail: AgentPaymentRail;
  licenseType: AgentLicenseType;
  priceUsd: number;
  budgetRemainingUsd: number;
  allowedRails?: AgentPaymentRail[];
  allowedLicenseTypes?: AgentLicenseType[];
}

export interface PolicyGuardResult {
  allowed: boolean;
  reason: "policy_ok" | "budget_exceeded" | "rail_not_allowed" | "license_not_allowed";
  remainingUsd: number;
}

@Injectable()
export class PolicyGuardService {
  evaluate(input: PolicyGuardInput): PolicyGuardResult {
    const allowedRails = input.allowedRails ?? ["erc4337_marketplace", "x402"];
    if (!allowedRails.includes(input.rail)) {
      return {
        allowed: false,
        reason: "rail_not_allowed",
        remainingUsd: input.budgetRemainingUsd,
      };
    }

    const allowedLicenseTypes =
      input.allowedLicenseTypes ?? ["personal", "remix", "commercial"];
    if (!allowedLicenseTypes.includes(input.licenseType)) {
      return {
        allowed: false,
        reason: "license_not_allowed",
        remainingUsd: input.budgetRemainingUsd,
      };
    }

    const remainingUsd = input.budgetRemainingUsd - input.priceUsd;
    if (remainingUsd < 0) {
      return {
        allowed: false,
        reason: "budget_exceeded",
        remainingUsd: input.budgetRemainingUsd,
      };
    }

    return {
      allowed: true,
      reason: "policy_ok",
      remainingUsd,
    };
  }
}
