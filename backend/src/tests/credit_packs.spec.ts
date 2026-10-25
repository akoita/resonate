/**
 * Credit pack catalogue and configuration (#1422): three server-side packs
 * ($5 minimum, $10 default, $25), credits equal to the price before tax, Stripe
 * price ids only from the environment, and the refunded share of a pack.
 */
import {
  CREDIT_PACKS,
  CREDIT_PACK_IDS,
  CreditPackConfig,
  DEFAULT_CREDIT_PACK_ID,
  findCreditPack,
  formatUsd,
} from "../modules/billing/credit_packs";
import { refundedCreditsShare } from "../modules/billing/credit_topup.service";

const PRICES = {
  STRIPE_PRICE_CREDITS_5: "price_c5",
  STRIPE_PRICE_CREDITS_10: "price_c10",
  STRIPE_PRICE_CREDITS_25: "price_c25",
};

describe("credit packs (#1422)", () => {
  it("sells $5 (the minimum), $10 (the default) and $25, crediting the price before tax", () => {
    expect(CREDIT_PACKS.map((pack) => [pack.id, pack.priceCents, pack.creditsCents])).toEqual([
      ["credits_5", 500, 500],
      ["credits_10", 1000, 1000],
      ["credits_25", 2500, 2500],
    ]);
    expect(Math.min(...CREDIT_PACKS.map((pack) => pack.priceCents))).toBe(500);
    expect(DEFAULT_CREDIT_PACK_ID).toBe("credits_10");
    expect(CREDIT_PACK_IDS).toEqual(["credits_5", "credits_10", "credits_25"]);
    expect(Object.isFrozen(CREDIT_PACKS)).toBe(true);
  });

  it("finds a pack by id only; amounts and unknown ids find nothing", () => {
    expect(findCreditPack("credits_25")?.priceCents).toBe(2500);
    for (const value of ["credits_1", 1000, "1000", null, undefined, { id: "credits_10" }]) {
      expect(findCreditPack(value)).toBeNull();
    }
  });

  it("reads each Stripe price from the environment and has no default", () => {
    const off = new CreditPackConfig({});
    expect(off.isConfigured()).toBe(false);
    expect(off.missing).toEqual(["STRIPE_PRICE_CREDITS_5", "STRIPE_PRICE_CREDITS_10", "STRIPE_PRICE_CREDITS_25"]);
    expect(off.priceFor("credits_10")).toBe("");

    const partial = new CreditPackConfig({ STRIPE_PRICE_CREDITS_5: "price_c5", STRIPE_PRICE_CREDITS_10: "  " });
    expect(partial.isConfigured()).toBe(false);
    expect(partial.missing).toEqual(["STRIPE_PRICE_CREDITS_10", "STRIPE_PRICE_CREDITS_25"]);

    const on = new CreditPackConfig(PRICES);
    expect(on.isConfigured()).toBe(true);
    expect(on.priceFor("credits_5")).toBe("price_c5");
    expect(on.priceFor("credits_25")).toBe("price_c25");
  });

  it("formats dollars", () => {
    expect(formatUsd(1000)).toBe("$10.00");
    expect(formatUsd(5)).toBe("$0.05");
  });

  describe("refundedCreditsShare", () => {
    it("withdraws every credit on a full refund, whatever the amounts", () => {
      expect(refundedCreditsShare({ creditsCents: 1000, amountRefunded: 1200, amountCharged: 1200, fullyRefunded: true })).toBe(1000);
    });

    it("withdraws the refunded share, rounded down, on a partial refund (tax included in the charge)", () => {
      // $10 pack charged $12 with tax; $6 refunded = half.
      expect(refundedCreditsShare({ creditsCents: 1000, amountRefunded: 600, amountCharged: 1200, fullyRefunded: false })).toBe(500);
      expect(refundedCreditsShare({ creditsCents: 500, amountRefunded: 1, amountCharged: 3, fullyRefunded: false })).toBe(166);
    });

    it("never exceeds the pack and never goes negative", () => {
      expect(refundedCreditsShare({ creditsCents: 1000, amountRefunded: 5000, amountCharged: 1000, fullyRefunded: false })).toBe(1000);
      expect(refundedCreditsShare({ creditsCents: 1000, amountRefunded: 0, amountCharged: 1000, fullyRefunded: false })).toBe(0);
      expect(refundedCreditsShare({ creditsCents: 1000, amountRefunded: 10, amountCharged: 0, fullyRefunded: false })).toBe(0);
    });
  });
});
