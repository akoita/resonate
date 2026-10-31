/**
 * The service period read off a paid subscription invoice (#2497): the first
 * non-proration subscription line, else the span of the dated lines, else the
 * invoice's own period, else nothing. Pure: no database.
 */
import type { StripeInvoice } from "../modules/billing/stripe_gateway";
import { invoiceServicePeriod } from "../modules/billing/subscription_invoices";

const T = (day: number) => Date.UTC(2026, 9, day) / 1000;
const d = (day: number) => new Date(T(day) * 1000);

function subLine(start: number, end: number, proration = false) {
  return {
    period: { start, end },
    parent: { type: "subscription_item_details", subscription_item_details: { proration } },
  };
}

function invoice(lines: unknown[], extra: Record<string, unknown> = {}): StripeInvoice {
  return { id: "in_test", object: "invoice", lines: { data: lines }, ...extra } as unknown as StripeInvoice;
}

describe("invoiceServicePeriod (#2497)", () => {
  it("prefers the first non-proration subscription line over earlier proration lines", () => {
    const result = invoiceServicePeriod(
      invoice([subLine(T(2), T(10), true), subLine(T(10), T(20)), subLine(T(20), T(30))], {
        period_start: T(1),
        period_end: T(31),
      }),
    );
    expect(result).toEqual({ periodStart: d(10), periodEnd: d(20) });
  });

  it("falls back to the span of all dated lines when only prorations exist", () => {
    const result = invoiceServicePeriod(invoice([subLine(T(12), T(20), true), subLine(T(5), T(12), true)]));
    expect(result).toEqual({ periodStart: d(5), periodEnd: d(20) });
  });

  it("ignores lines with an invalid period when taking the span", () => {
    const result = invoiceServicePeriod(
      invoice([{ period: { start: T(9), end: T(9) } }, { period: { start: T(3), end: T(8) } }, { period: {} }]),
    );
    expect(result).toEqual({ periodStart: d(3), periodEnd: d(8) });
  });

  it("falls back to the invoice's own period when no line carries one", () => {
    const result = invoiceServicePeriod(invoice([], { period_start: T(1), period_end: T(31) }));
    expect(result).toEqual({ periodStart: d(1), periodEnd: d(31) });
  });

  it("returns null when nothing names a valid period", () => {
    expect(invoiceServicePeriod(invoice([]))).toBeNull();
    expect(invoiceServicePeriod(invoice([subLine(T(10), T(10))], { period_start: T(5), period_end: T(4) }))).toBeNull();
    expect(invoiceServicePeriod({ id: "in_x" } as unknown as StripeInvoice)).toBeNull();
  });
});
