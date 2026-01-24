"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePrice = calculatePrice;
function calculatePrice(licenseType, input, volumeEligible) {
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
