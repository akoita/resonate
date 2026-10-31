import { BadRequestException } from "@nestjs/common";
import {
  BillingReconciliationReport,
  REPORT_SECTIONS,
  ledgerReasonLabel,
  parseReportMonth,
  sectionToCsv,
  toCsv,
} from "../modules/billing/billing_reconciliation";

const NOW = new Date("2026-10-31T12:00:00.000Z");

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse();
  }
  throw new Error("expected a BadRequestException");
}

describe("parseReportMonth", () => {
  it("parses a past month as a complete half-open UTC period", () => {
    const p = parseReportMonth("2026-06", NOW);
    expect(p.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(p.complete).toBe(true);
  });

  it("rolls December into January of the next year", () => {
    const p = parseReportMonth("2025-12", NOW);
    expect(p.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("marks the current month incomplete", () => {
    const p = parseReportMonth("2026-10", NOW);
    expect(p.complete).toBe(false);
    expect(p.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("counts a month ending exactly now as complete", () => {
    expect(parseReportMonth("2026-10", new Date("2026-11-01T00:00:00.000Z")).complete).toBe(true);
  });

  it.each(["2026-13", "2026-00", "2026-6", "26-06", "2026/06", "2026-06-01", "", " 2026-06"])(
    "rejects %p as invalid_month",
    (month) => {
      expect(codeOf(() => parseReportMonth(month, NOW))).toMatchObject({ code: "invalid_month" });
    },
  );

  it("rejects a month that has not started", () => {
    expect(codeOf(() => parseReportMonth("2026-11", NOW))).toMatchObject({ code: "month_in_future" });
  });
});

describe("toCsv", () => {
  it("writes a header first, CRLF line ends and a trailing CRLF", () => {
    expect(toCsv(["a", "b"], [{ a: 1, b: "x" }, { a: 2, b: "y" }])).toBe("a,b\r\n1,x\r\n2,y\r\n");
  });

  it("quotes fields with commas, quotes and line breaks, doubling quotes", () => {
    const csv = toCsv(["a"], [{ a: 'say "hi", ok' }, { a: "line\nbreak" }, { a: "cr\rhere" }]);
    expect(csv).toBe('a\r\n"say ""hi"", ok"\r\n"line\nbreak"\r\n"cr\rhere"\r\n');
  });

  it("writes null and undefined as empty and Dates as ISO", () => {
    expect(toCsv(["a", "b", "c"], [{ a: null, c: new Date("2026-06-01T00:00:00.000Z") }])).toBe(
      "a,b,c\r\n,,2026-06-01T00:00:00.000Z\r\n",
    );
  });

  it("guards strings a spreadsheet would evaluate but leaves numbers numeric", () => {
    const csv = toCsv(["a"], [{ a: "=SUM(A1)" }, { a: "+1" }, { a: "-1" }, { a: "@x" }, { a: "\tx" }, { a: -5 }, { a: "ok" }]);
    expect(csv.split("\r\n")).toEqual(["a", "'=SUM(A1)", "'+1", "'-1", "'@x", "'\tx", "-5", "ok", ""]);
  });
});

describe("ledgerReasonLabel", () => {
  it("names the known grant reasons and hides operator text", () => {
    expect(ledgerReasonLabel("grant", "top_up")).toBe("top_up");
    expect(ledgerReasonLabel("grant", "signup_starter")).toBe("signup_starter");
    expect(ledgerReasonLabel("grant", "Credit request top-up")).toBe("credit_request");
    const label = ledgerReasonLabel("grant", "Gift for Alice Example");
    expect(label).toBe("operator_grant");
    expect(label).not.toMatch(/alice/i);
    expect(ledgerReasonLabel("grant", "")).toBe("operator_grant");
  });

  it("keeps a short code for debits and refunds and hides anything else", () => {
    expect(ledgerReasonLabel("debit", "generation.lyria_clip")).toBe("generation.lyria_clip");
    expect(ledgerReasonLabel("refund", "job_failed")).toBe("job_failed");
    expect(ledgerReasonLabel("debit", "Some Free Text")).toBe("other");
    expect(ledgerReasonLabel("debit", "")).toBe("other");
    expect(ledgerReasonLabel("debit", "a".repeat(65))).toBe("other");
  });
});

describe("sectionToCsv", () => {
  const report = {
    creditPacks: { purchases: [], refunds: [], needsReview: [] },
    heldPurchases: { openingCents: 1, purchasedCents: 2, creditedCents: 3, refundWithdrawnCents: 4, closingCents: 5, computedClosingCents: 5, balanced: true },
    creditBalance: {
      openingCents: 10,
      grants: [{ label: "top_up", count: 1, cents: 100 }],
      topUpGrantsCents: 100,
      freeGrantsCents: 0,
      spends: { count: 1, cents: 30 },
      spendsByReason: [{ label: "gen", count: 1, cents: 30 }],
      jobRefunds: { count: 0, cents: 0 },
      jobRefundsByReason: [],
      topUpRefundReversals: { count: 0, cents: 0 },
      unclassified: { count: 0 },
      closingCents: 80,
      computedClosingCents: 80,
      balanced: false,
    },
    allowance: { grantedCount: 1, grantedCents: 50, usedCents: 5, returnedCents: 1, lapsedCents: 0 },
    subscriptionInvoices: [],
    controlTotals: [
      {
        currency: "usd",
        creditPackPurchases: { count: 1, priceCents: 500, chargedCents: 600, chargedUnknownCount: 0 },
        creditPackRefunds: { count: 0, amountCents: 0 },
        needsReview: { count: 0, priceCents: 0, chargedCents: 0, chargedUnknownCount: 0 },
        subscriptionInvoices: { count: 0, amountPaidCents: 0 },
        netCollectedCents: 600,
      },
    ],
  } as unknown as BillingReconciliationReport;

  it("renders every section with its header", () => {
    for (const section of REPORT_SECTIONS) {
      const csv = sectionToCsv(report, section);
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv.split("\r\n")[0].length).toBeGreaterThan(0);
    }
  });

  it("flattens roll-forwards to line,count,cents with a balanced flag", () => {
    const lines = sectionToCsv(report, "credit_balance").split("\r\n");
    expect(lines[0]).toBe("line,count,cents");
    expect(lines).toContain("opening,,10");
    expect(lines).toContain("grant:top_up,1,100");
    expect(lines).toContain("spend:gen,1,30");
    expect(lines).toContain("balanced,,0");
    expect(sectionToCsv(report, "held_purchases").split("\r\n")).toContain("balanced,,1");
  });

  it("flattens control totals to one row per currency", () => {
    const lines = sectionToCsv(report, "control_totals").split("\r\n");
    expect(lines[1]).toBe("usd,1,500,600,0,0,0,0,0,0,0,0,0,600");
  });
});
