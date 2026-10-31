/**
 * Credit pack catalogue and configuration (#1422, #2496): three server-side
 * packs ($5/€5 minimum, $10/€10 default, $25/€25), credits equal to the pack's
 * price in either currency, the price check fulfilment applies, Stripe price
 * ids only from the environment, and the refunded share of a pack.
 */
import { formatMoney, taxPhrase } from "../modules/billing/billing_currency";
import {
  CREDIT_PACKS,
  CREDIT_PACK_IDS,
  CreditPackConfig,
  DEFAULT_CREDIT_PACK_ID,
  creditPackLabel,
  findCreditPack,
  formatUsd,
  paidCurrency,
} from "../modules/billing/credit_packs";
import { refundedCreditsShare } from "../modules/billing/credit_topup.service";

const PRICES = {
  STRIPE_PRICE_CREDITS_5: "price_c5",
  STRIPE_PRICE_CREDITS_10: "price_c10",
  STRIPE_PRICE_CREDITS_25: "price_c25",
};

describe("credit packs (#1422)", () => {
  it("sells $5/€5 (the minimum), $10/€10 (the default) and $25/€25, crediting the pack's price at face value", () => {
    expect(CREDIT_PACKS.map((pack) => [pack.id, pack.prices.usd, pack.prices.eur, pack.creditsCents])).toEqual([
      ["credits_5", 500, 500, 500],
      ["credits_10", 1000, 1000, 1000],
      ["credits_25", 2500, 2500, 2500],
    ]);
    expect(Math.min(...CREDIT_PACKS.map((pack) => pack.prices.usd))).toBe(500);
    expect(creditPackLabel(CREDIT_PACKS[1], "usd")).toBe("$10 credit pack");
    expect(creditPackLabel(CREDIT_PACKS[1], "eur")).toBe("€10 credit pack");
    expect(DEFAULT_CREDIT_PACK_ID).toBe("credits_10");
    expect(CREDIT_PACK_IDS).toEqual(["credits_5", "credits_10", "credits_25"]);
    expect(Object.isFrozen(CREDIT_PACKS)).toBe(true);
  });

  it("finds a pack by id only; amounts and unknown ids find nothing", () => {
    expect(findCreditPack("credits_25")?.prices.usd).toBe(2500);
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

  it("formats dollars, euros and an unexpected currency, and names how tax reads", () => {
    expect(formatUsd(1000)).toBe("$10.00");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatMoney(1000, "eur")).toBe("€10.00");
    expect(formatMoney(1000, "USD")).toBe("$10.00");
    expect(formatMoney(1000, "gbp")).toBe("10.00 GBP");
    expect(taxPhrase("eur")).toBe("VAT included");
    expect(taxPhrase("usd")).toBe("before any tax");
  });

  describe("paidCurrency (the fulfilment price check)", () => {
    const pack = findCreditPack("credits_10")!;

    it("accepts the pack's price in USD (subtotal before tax) or EUR, case-insensitively", () => {
      expect(paidCurrency(pack, { currency: "usd", amount_subtotal: 1000, amount_total: 1200 })).toBe("usd");
      expect(paidCurrency(pack, { currency: "EUR", amount_subtotal: 1000, amount_total: 1000 })).toBe("eur");
    });

    it("accepts EUR whether Stripe reports the included VAT inside the subtotal or beside it", () => {
      // VAT included in the subtotal (what Stripe documents for inclusive prices).
      expect(
        paidCurrency(pack, { currency: "eur", amount_subtotal: 1000, amount_total: 1000, total_details: { amount_tax: 167 } }),
      ).toBe("eur");
      // VAT reported beside a net subtotal: subtotal + tax and the total are both the price.
      expect(
        paidCurrency(pack, { currency: "eur", amount_subtotal: 833, amount_total: 1000, total_details: { amount_tax: 167 } }),
      ).toBe("eur");
    });

    it("refuses anything else: another amount, a discount, USD tax inside the subtotal, another currency", () => {
      expect(paidCurrency(pack, { currency: "usd", amount_subtotal: 999 })).toBeNull();
      expect(paidCurrency(pack, { currency: "usd", amount_subtotal: 833, amount_total: 1000, total_details: { amount_tax: 167 } })).toBeNull();
      expect(paidCurrency(pack, { currency: "eur", amount_subtotal: 500, amount_total: 500 })).toBeNull();
      expect(
        paidCurrency(pack, {
          currency: "eur",
          amount_subtotal: 833,
          amount_total: 1000,
          total_details: { amount_tax: 167, amount_discount: 100 },
        }),
      ).toBeNull();
      expect(paidCurrency(pack, { currency: "eur", amount_subtotal: 833, amount_total: 900, total_details: { amount_tax: 167 } })).toBeNull();
      expect(paidCurrency(pack, { currency: "gbp", amount_subtotal: 1000, amount_total: 1000 })).toBeNull();
      expect(paidCurrency(pack, { currency: null, amount_subtotal: 1000 })).toBeNull();
      expect(paidCurrency(pack, { currency: "usd", amount_subtotal: null })).toBeNull();
    });
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
