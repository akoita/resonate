import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenerationCreditBalance } from "../../lib/api";
import { CreditBalanceMeter } from "./CreditBalanceMeter";

function balance(
  overrides: Partial<GenerationCreditBalance> = {},
): GenerationCreditBalance {
  return {
    balanceCents: 100,
    priceCentsPer30s: 10,
    recentTransactions: [],
    ...overrides,
  };
}

describe("CreditBalanceMeter", () => {
  it("renders remaining capacity for a funded balance (strip)", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter variant="strip" balance={balance()} />,
    );
    expect(html).toContain("Credits");
    expect(html).toContain("≈ 5 min · 5 tracks");
    // No request affordance while funded.
    expect(html).not.toContain("Request credits");
  });

  it("renders capacity in the panel variant too", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter variant="panel" balance={balance()} />,
    );
    expect(html).toContain("Generation credits");
    expect(html).toContain("≈ 5 min · 5 tracks");
  });

  it("shows the empty state and the request button when empty and a handler is given", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter
        variant="strip"
        balance={balance({ balanceCents: 0 })}
        onRequestCredits={() => {}}
      />,
    );
    expect(html).toContain("0 — top up");
    expect(html).toContain("Request credits");
  });

  it("surfaces the request affordance for a low (non-empty) balance", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter
        variant="panel"
        balance={balance({ balanceCents: 5 })}
        onRequestCredits={() => {}}
      />,
    );
    expect(html).toContain("Request credits from an operator");
  });

  it("does not render the request button when no handler is provided even if empty", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter variant="strip" balance={balance({ balanceCents: 0 })} />,
    );
    expect(html).toContain("0 — top up");
    expect(html).not.toContain("Request credits");
  });

  it("renders nothing when the balance is null and not loading", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter variant="strip" balance={null} />,
    );
    expect(html).toBe("");
  });

  it("renders a loading placeholder for the panel when balance is null and loading", () => {
    const html = renderToStaticMarkup(
      <CreditBalanceMeter variant="panel" balance={null} loading />,
    );
    expect(html).toContain("Generation credits");
    expect(html).toContain("Loading…");
  });
});
