/**
 * Artist Pro monthly allowance, pure rules (#2408): size resolution, monthly
 * slicing of a paid period (monthly and annual), which invoices grant, and
 * the allowance-first split of a charge.
 */
import {
  DEFAULT_ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS,
  addUtcMonthsClamped,
  invoiceAllowancePeriod,
  monthlySlices,
  resolveMonthlyAllowanceCents,
  splitCharge,
} from "../modules/credits/allowance";
import type { StripeInvoice } from "../modules/billing/stripe_gateway";

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function invoice(overrides: Record<string, unknown> = {}, lines?: unknown[]): StripeInvoice {
  return {
    id: "in_1",
    object: "invoice",
    amount_paid: 1499,
    billing_reason: "subscription_cycle",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
    lines: {
      data: lines ?? [
        {
          period: { start: sec("2026-03-01T10:00:00Z"), end: sec("2026-04-01T10:00:00Z") },
          parent: { type: "subscription_item_details", subscription_item_details: { proration: false } },
        },
      ],
    },
    ...overrides,
  } as unknown as StripeInvoice;
}

describe("allowance size", () => {
  it("defaults to $3.00 and accepts a non-negative integer override", () => {
    expect(DEFAULT_ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS).toBe(300);
    expect(resolveMonthlyAllowanceCents(undefined)).toBe(300);
    expect(resolveMonthlyAllowanceCents("")).toBe(300);
    expect(resolveMonthlyAllowanceCents("450")).toBe(450);
    expect(resolveMonthlyAllowanceCents(0)).toBe(0);
    expect(resolveMonthlyAllowanceCents("0")).toBe(0);
  });

  it("falls back to the default for anything that is not integer cents", () => {
    for (const raw of ["-1", "2.5", "abc", -5, 1.5, Number.NaN]) {
      expect(resolveMonthlyAllowanceCents(raw)).toBe(300);
    }
  });
});

describe("addUtcMonthsClamped", () => {
  it("keeps the day and time, clamping to a shorter month", () => {
    const anchor = new Date("2026-01-31T08:30:00.000Z");
    expect(addUtcMonthsClamped(anchor, 1).toISOString()).toBe("2026-02-28T08:30:00.000Z");
    expect(addUtcMonthsClamped(anchor, 2).toISOString()).toBe("2026-03-31T08:30:00.000Z");
    expect(addUtcMonthsClamped(anchor, 13).toISOString()).toBe("2027-02-28T08:30:00.000Z");
    expect(addUtcMonthsClamped(new Date("2027-12-15T00:00:00Z"), 2).toISOString()).toBe("2028-02-15T00:00:00.000Z");
    expect(addUtcMonthsClamped(new Date("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
});

describe("monthlySlices", () => {
  it("gives one slice for a monthly period, covering it exactly", () => {
    const start = new Date("2026-01-31T00:00:00Z");
    const end = new Date("2026-02-28T00:00:00Z");
    expect(monthlySlices(start, end)).toEqual([{ sliceIndex: 0, periodStart: start, expiresAt: end }]);
  });

  it("cuts an annual period into twelve consecutive monthly slices ending at the period end", () => {
    const start = new Date("2026-01-31T12:00:00Z");
    const end = new Date("2027-01-31T12:00:00Z");
    const slices = monthlySlices(start, end);
    expect(slices).toHaveLength(12);
    expect(slices[0].periodStart).toEqual(start);
    expect(slices[1].periodStart.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(slices[2].periodStart.toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(slices[11].expiresAt).toEqual(end);
    for (let index = 1; index < slices.length; index += 1) {
      expect(slices[index].periodStart).toEqual(slices[index - 1].expiresAt);
      expect(slices[index].sliceIndex).toBe(index);
    }
  });

  it("handles a leap-year annual period and refuses an empty one", () => {
    expect(monthlySlices(new Date("2028-01-01T00:00:00Z"), new Date("2029-01-01T00:00:00Z"))).toHaveLength(12);
    expect(monthlySlices(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toEqual([]);
    expect(monthlySlices(new Date("2026-02-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toEqual([]);
  });

  it("is deterministic: the same period always gives the same windows", () => {
    const a = monthlySlices(new Date("2026-05-17T03:04:05Z"), new Date("2027-05-17T03:04:05Z"));
    const b = monthlySlices(new Date("2026-05-17T03:04:05Z"), new Date("2027-05-17T03:04:05Z"));
    expect(a).toEqual(b);
  });
});

describe("invoiceAllowancePeriod", () => {
  it("reads the paid period from the subscription line of a cycle or create invoice", () => {
    for (const reason of ["subscription_cycle", "subscription_create"]) {
      expect(invoiceAllowancePeriod(invoice({ billing_reason: reason }))).toEqual({
        grant: true,
        invoiceId: "in_1",
        stripeSubscriptionId: "sub_1",
        periodStart: new Date("2026-03-01T10:00:00Z"),
        periodEnd: new Date("2026-04-01T10:00:00Z"),
      });
    }
  });

  it("accepts an expanded subscription object", () => {
    const result = invoiceAllowancePeriod(
      invoice({ parent: { subscription_details: { subscription: { id: "sub_x" } } } }),
    );
    expect(result).toMatchObject({ grant: true, stripeSubscriptionId: "sub_x" });
  });

  it("grants a plan change only when it carries a full, non-proration period line", () => {
    const proration = {
      period: { start: sec("2026-03-10T00:00:00Z"), end: sec("2026-04-01T10:00:00Z") },
      parent: { type: "subscription_item_details", subscription_item_details: { proration: true } },
    };
    const annual = {
      period: { start: sec("2026-03-10T00:00:00Z"), end: sec("2027-03-10T00:00:00Z") },
      parent: { type: "subscription_item_details", subscription_item_details: { proration: false } },
    };
    expect(invoiceAllowancePeriod(invoice({ billing_reason: "subscription_update" }, [proration]))).toEqual({
      grant: false,
      reason: "not_period_opening",
    });
    expect(invoiceAllowancePeriod(invoice({ billing_reason: "subscription_update" }, [proration, annual]))).toMatchObject({
      grant: true,
      periodStart: new Date("2026-03-10T00:00:00Z"),
      periodEnd: new Date("2027-03-10T00:00:00Z"),
    });
  });

  it("grants nothing for invoices that open no period or cannot be read", () => {
    expect(invoiceAllowancePeriod(invoice({ billing_reason: "manual" }))).toEqual({ grant: false, reason: "not_period_opening" });
    expect(invoiceAllowancePeriod(invoice({ billing_reason: "subscription_threshold" }))).toEqual({
      grant: false,
      reason: "not_period_opening",
    });
    expect(invoiceAllowancePeriod(invoice({ id: undefined }))).toEqual({ grant: false, reason: "unparseable" });
    expect(invoiceAllowancePeriod(null)).toEqual({ grant: false, reason: "unparseable" });
    expect(invoiceAllowancePeriod(invoice({ parent: null }))).toEqual({ grant: false, reason: "no_subscription" });
    expect(invoiceAllowancePeriod(invoice({}, []))).toEqual({ grant: false, reason: "no_period_line" });
    expect(
      invoiceAllowancePeriod(
        invoice({}, [{ period: { start: 0, end: 0 }, parent: { type: "subscription_item_details", subscription_item_details: {} } }]),
      ),
    ).toEqual({ grant: false, reason: "no_period_line" });
  });
});

describe("splitCharge", () => {
  it("spends the allowance first, then the balance, never below zero", () => {
    expect(splitCharge(10, 300)).toEqual({ fromAllowanceCents: 10, fromBalanceCents: 0 });
    expect(splitCharge(10, 4)).toEqual({ fromAllowanceCents: 4, fromBalanceCents: 6 });
    expect(splitCharge(10, 0)).toEqual({ fromAllowanceCents: 0, fromBalanceCents: 10 });
    expect(splitCharge(10, -3)).toEqual({ fromAllowanceCents: 0, fromBalanceCents: 10 });
  });
});

describe("unpaid invoices (#2408 decision)", () => {
  it("grants nothing for an invoice nobody paid for", () => {
    expect(invoiceAllowancePeriod(invoice({ amount_paid: 0 }))).toEqual({ grant: false, reason: "unpaid_invoice" });
    expect(invoiceAllowancePeriod(invoice({ amount_paid: undefined }))).toEqual({ grant: false, reason: "unpaid_invoice" });
  });

  it("grants for a paid invoice", () => {
    expect(invoiceAllowancePeriod(invoice({ amount_paid: 1499 })).grant).toBe(true);
  });
});
