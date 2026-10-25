import { describe, expect, it } from "vitest";
import { canAffordGeneration, formatCreditCapacity, spendableCents } from "./credits";

describe("spendableCents (#2408)", () => {
  it("counts the Pro allowance with the balance when the response reports it", () => {
    expect(spendableCents({ balanceCents: 0, spendableCents: 300 })).toBe(300);
    expect(spendableCents({ balanceCents: 50, spendableCents: 350 })).toBe(350);
  });

  it("falls back to the balance for a response without it", () => {
    expect(spendableCents({ balanceCents: 70 })).toBe(70);
  });

  it("lets an allowance-only subscriber afford a generation", () => {
    expect(canAffordGeneration(spendableCents({ balanceCents: 0, spendableCents: 300 }), 10)).toBe(true);
  });
});

describe("formatCreditCapacity", () => {
  it("reports whole-minute capacity for a funded balance", () => {
    // 100¢ at 10¢/30s → 300s → 5 min → 5 whole 1-min tracks.
    const cap = formatCreditCapacity(100, 10);
    expect(cap).toEqual({ minLabel: "5", tracks: 5, empty: false, low: false });
  });

  it("keeps a fractional-minute label to one decimal", () => {
    // 90¢ at 10¢/30s → 270s → 4.5 min → 4 whole tracks.
    const cap = formatCreditCapacity(90, 10);
    expect(cap.minLabel).toBe("4.5");
    expect(cap.tracks).toBe(4);
    expect(cap.low).toBe(false);
  });

  it("marks a zero balance as empty", () => {
    const cap = formatCreditCapacity(0, 10);
    expect(cap).toEqual({ minLabel: "0", tracks: 0, empty: true, low: false });
  });

  it("marks a positive-but-sub-one-track balance as low with a <1 label", () => {
    // 5¢ at 10¢/30s → 15s → 0.25 min → 0 whole tracks.
    const cap = formatCreditCapacity(5, 10);
    expect(cap.minLabel).toBe("<1");
    expect(cap.tracks).toBe(0);
    expect(cap.empty).toBe(false);
    expect(cap.low).toBe(true);
  });

  it("guards a zero/invalid price without dividing by zero", () => {
    const cap = formatCreditCapacity(100, 0);
    // No price → no derivable capacity, but the balance is still positive.
    expect(cap.minLabel).toBe("0");
    expect(cap.tracks).toBe(0);
    expect(cap.empty).toBe(false);
    expect(cap.low).toBe(true);
  });

  it("treats a zero balance with a zero price as empty", () => {
    const cap = formatCreditCapacity(0, 0);
    expect(cap.empty).toBe(true);
    expect(cap.low).toBe(false);
  });
});

describe("canAffordGeneration", () => {
  it("is true when the balance covers at least one 30s block", () => {
    expect(canAffordGeneration(10, 10)).toBe(true);
    expect(canAffordGeneration(25, 10)).toBe(true);
  });

  it("is false when the balance can't fund one block", () => {
    expect(canAffordGeneration(5, 10)).toBe(false);
    expect(canAffordGeneration(0, 10)).toBe(false);
  });

  it("treats a non-positive price as affordable (backend owns cost)", () => {
    expect(canAffordGeneration(0, 0)).toBe(true);
  });
});
