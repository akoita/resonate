export type LicenseType = "personal" | "remix" | "commercial";

export interface PricingInput {
  basePlayPriceUsd: number;
  remixSurchargeMultiplier: number;
  commercialMultiplier: number;
  volumeDiscountPercent: number;
  floorUsd: number;
  ceilingUsd: number;
}

export function calculatePrice(
  licenseType: LicenseType,
  input: PricingInput,
  volumeEligible: boolean
): number {
  let price = input.basePlayPriceUsd;
  if (licenseType === "remix") {
    price *= input.remixSurchargeMultiplier;
  }
  if (licenseType === "commercial") {
    price *= input.commercialMultiplier;
  }
  if (volumeEligible) {
    price *= 1 - input.volumeDiscountPercent / 100;
  }
  if (price < input.floorUsd) {
    return input.floorUsd;
  }
  if (price > input.ceilingUsd) {
    return input.ceilingUsd;
  }
  return Number(price.toFixed(2));
}
