"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pricing_1 = require("../pricing/pricing");
describe("pricing", () => {
    it("applies multipliers and floors/ceilings", () => {
        const price = (0, pricing_1.calculatePrice)("commercial", {
            basePlayPriceUsd: 0.5,
            remixSurchargeMultiplier: 1.5,
            commercialMultiplier: 3,
            volumeDiscountPercent: 0,
            floorUsd: 0.25,
            ceilingUsd: 2,
        }, false);
        expect(price).toBe(1.5);
    });
});
