import { Injectable } from "@nestjs/common";
import { calculatePrice, PricingInput } from "../../pricing/pricing";

export interface AgentPolicyInput {
  sessionId: string;
  userId: string;
  trackId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
  };
}

@Injectable()
export class AgentPolicyService {
  evaluate(input: AgentPolicyInput) {
    const licenseType = input.preferences.licenseType ?? "personal";
    const priceUsd = calculatePrice(
      licenseType,
      this.defaultPricing(),
      input.recentTrackIds.length > 5
    );
    const allowed = priceUsd <= input.budgetRemainingUsd;
    return {
      allowed,
      licenseType,
      priceUsd,
      reason: allowed ? "policy_ok" : "budget_exceeded",
    };
  }

  private defaultPricing(): PricingInput {
    return {
      basePlayPriceUsd: 0.02,
      remixSurchargeMultiplier: 3,
      commercialMultiplier: 5,
      volumeDiscountPercent: 5,
      floorUsd: 0.01,
      ceilingUsd: 1,
    };
  }
}
