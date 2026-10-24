import { METERED_ACTIONS, unitCostCents } from "../modules/credits/metered-actions";
import {
  buildUsageBreakdown,
  buildUsageLimits,
  percentLeft,
} from "../modules/usage/usage-aggregation";

describe("percentLeft", () => {
  it("rounds and clamps to 0-100", () => {
    expect(percentLeft(50, 50)).toBe(100);
    expect(percentLeft(48, 50)).toBe(96);
    expect(percentLeft(1, 3)).toBe(33);
    expect(percentLeft(0, 10)).toBe(0);
    expect(percentLeft(-4, 10)).toBe(0);
    expect(percentLeft(20, 10)).toBe(100);
  });

  it("is 0 when the limit is not positive", () => {
    expect(percentLeft(5, 0)).toBe(0);
    expect(percentLeft(5, NaN)).toBe(0);
  });
});

describe("buildUsageLimits", () => {
  const resetsAt = new Date("2026-10-24T12:42:00.000Z");

  it("returns a window row per registered kind with % left and reset time", () => {
    const rows = buildUsageLimits({
      lyria: { remaining: 40, limit: 50, windowMs: 3_600_000, resetsAt },
      remix_draft: { remaining: 10, limit: 10, windowMs: 3_600_000, resetsAt: null },
    });
    expect(rows).toEqual([
      {
        kind: "lyria",
        label: METERED_ACTIONS.lyria.label,
        remaining: 40,
        limit: 50,
        percentLeft: 80,
        windowSeconds: 3600,
        resetsAt: "2026-10-24T12:42:00.000Z",
      },
      {
        kind: "remix_draft",
        label: METERED_ACTIONS.remix_draft.label,
        remaining: 10,
        limit: 10,
        percentLeft: 100,
        windowSeconds: 3600,
        resetsAt: null,
      },
    ]);
  });

  it("reports an exhausted window as 0% left with its reset time", () => {
    const [row] = buildUsageLimits({
      lyria: { remaining: 0, limit: 50, windowMs: 3_600_000, resetsAt },
    });
    expect(row.percentLeft).toBe(0);
    expect(row.resetsAt).toBe("2026-10-24T12:42:00.000Z");
  });

  it("skips a kind that has no live peek", () => {
    const rows = buildUsageLimits({
      lyria: { remaining: 1, limit: 2, windowMs: 1000, resetsAt: null },
    });
    expect(rows.map((r) => r.kind)).toEqual(["lyria"]);
  });
});

describe("buildUsageBreakdown", () => {
  const since = new Date("2026-09-24T00:00:00.000Z");

  it("lists every registered kind with zeros when nothing was spent", () => {
    const breakdown = buildUsageBreakdown({
      debits: [],
      refunds: [],
      priceCentsPer30s: 10,
      since,
    });
    expect(breakdown.periodDays).toBe(30);
    expect(breakdown.since).toBe("2026-09-24T00:00:00.000Z");
    expect(breakdown.items.map((i) => i.kind)).toEqual(["lyria", "remix_draft", "remix_draft"]);
    expect(breakdown.items.map((i) => i.label)).toEqual([
      "Track generation",
      "AI remix draft",
      "AI part takes",
    ]);
    for (const item of breakdown.items) {
      expect(item).toMatchObject({
        charges: 0,
        spentCents: 0,
        refundedCents: 0,
        netCents: 0,
      });
    }
  });

  it("derives the per-unit cost from the registry at the live price", () => {
    const breakdown = buildUsageBreakdown({
      debits: [],
      refunds: [],
      priceCentsPer30s: 14,
      since,
    });
    for (const item of breakdown.items) {
      expect(item.unitSeconds).toBe(METERED_ACTIONS[item.kind].cost.unitSeconds);
      expect(item.unitCostCents).toBe(unitCostCents(item.kind, 14));
    }
  });

  it("attributes debits by ledger reason and nets out refunds", () => {
    const breakdown = buildUsageBreakdown({
      debits: [
        { reason: "lyria_generation", count: 3, amountCents: 30 },
        { reason: "remix_draft", count: 2, amountCents: 20 },
        { reason: "remix_part", count: 1, amountCents: 5 },
      ],
      refunds: [
        { amountCents: 10, debitReason: "lyria_generation" },
        { amountCents: 5, debitReason: "remix_part" },
      ],
      priceCentsPer30s: 10,
      since,
    });
    const byLine = Object.fromEntries(
      breakdown.items.map((i) => [i.lineId, i]),
    );
    expect(byLine.lyria).toMatchObject({
      charges: 3,
      spentCents: 30,
      refundedCents: 10,
      netCents: 20,
    });
    expect(byLine.draft).toMatchObject({
      charges: 2,
      spentCents: 20,
      refundedCents: 0,
      netCents: 20,
    });
    expect(byLine.part_take).toMatchObject({
      label: "AI part takes",
      charges: 1,
      spentCents: 5,
      refundedCents: 5,
      netCents: 0,
    });
    // Presentation split only: the lines sum to the previous kind total.
    const remix = breakdown.items.filter((i) => i.kind === "remix_draft");
    expect(remix.reduce((n, i) => n + i.charges, 0)).toBe(3);
    expect(remix.reduce((n, i) => n + i.spentCents, 0)).toBe(25);
    expect(remix.reduce((n, i) => n + i.refundedCents, 0)).toBe(5);
    expect(remix.reduce((n, i) => n + i.netCents, 0)).toBe(20);
  });

  it("ignores ledger rows that match no registered kind", () => {
    const breakdown = buildUsageBreakdown({
      debits: [{ reason: "something_else", count: 9, amountCents: 99 }],
      refunds: [
        { amountCents: 7, debitReason: null },
        { amountCents: 7, debitReason: "something_else" },
      ],
      priceCentsPer30s: 10,
      since,
    });
    expect(breakdown.items.every((i) => i.netCents === 0)).toBe(true);
  });
});
