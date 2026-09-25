import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenerationCreditBalance } from "../../lib/api";
import {
  CREDIT_METER_EMPTY_NOTE,
  CREDIT_METER_LOW_NOTE,
  CreditBalanceMeter,
  formatPricePer30s,
} from "./CreditBalanceMeter";

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

describe("CreditBalanceMeter — inline (Remix Studio Create panel)", () => {
  function inline(
    overrides: Partial<GenerationCreditBalance> = {},
    extra: { price?: number | null; onRequest?: () => void } = {},
  ): string {
    return renderToStaticMarkup(
      <CreditBalanceMeter
        variant="inline"
        balance={balance(overrides)}
        priceCentsPer30s={extra.price}
        onRequestCredits={extra.onRequest}
      />,
    );
  }

  it("renders one compact ok row without a note or request button", () => {
    const html = inline({}, { onRequest: () => {} });
    expect(html).toContain('data-status="ok"');
    expect(html).toContain(">Credits<");
    expect(html).toContain("≈ 5 min · 5 tracks");
    expect(html).toContain("text-emerald-300");
    expect(html).not.toContain(CREDIT_METER_EMPTY_NOTE);
    expect(html).not.toContain(CREDIT_METER_LOW_NOTE.replaceAll("'", "&#x27;"));
    expect(html).not.toContain("Request credits");
    // Never the bordered panel block.
    expect(html).not.toContain("Generation credits");
  });

  it("appends the price only when one is passed", () => {
    expect(inline({}, { price: 10 })).toContain("· $0.10 per 30 s");
    expect(inline({}, { price: 125 })).toContain("· $1.25 per 30 s");
    expect(inline()).not.toContain("per 30 s");
    expect(inline({}, { price: null })).not.toContain("per 30 s");
  });

  it("explains an empty balance and offers a request button", () => {
    const html = inline({ balanceCents: 0 }, { onRequest: () => {} });
    expect(html).toContain('data-status="exhausted"');
    expect(html).toContain("0 — top up");
    expect(html).toContain("text-red-300");
    expect(html).toContain(CREDIT_METER_EMPTY_NOTE);
    expect(html).toMatch(/<button[^>]*ui-btn-ghost[^>]*>Request credits<\/button>/);
  });

  it("explains a low balance and offers a request button", () => {
    const html = inline({ balanceCents: 5 }, { onRequest: () => {} });
    expect(html).toContain('data-status="low"');
    expect(html).toContain("text-amber-300");
    expect(html).toContain("You&#x27;re running low on generation credits.");
    expect(html).toContain("Request credits");
  });

  it("omits the request button without a handler", () => {
    const html = inline({ balanceCents: 0 });
    expect(html).toContain(CREDIT_METER_EMPTY_NOTE);
    expect(html).not.toContain("<button");
  });

  it("never claims stem-mix renders need credits", () => {
    for (const cents of [0, 5, 100]) {
      const html = inline({ balanceCents: cents }, { price: 10, onRequest: () => {} });
      const text = html.replace(/<[^>]+>/g, " ");
      expect(text).not.toMatch(/won.t render/i);
      expect(text).not.toMatch(/\bmix/i);
    }
  });

  it("renders a compact loading row, or nothing, while the balance is unknown", () => {
    const loading = renderToStaticMarkup(
      <CreditBalanceMeter variant="inline" balance={null} loading />,
    );
    expect(loading).toContain("Credits");
    expect(loading).toContain("Loading…");
    expect(
      renderToStaticMarkup(<CreditBalanceMeter variant="inline" balance={null} />),
    ).toBe("");
  });
});

describe("formatPricePer30s", () => {
  it("formats cents per 30 s and rejects unknown prices", () => {
    expect(formatPricePer30s(10)).toBe("$0.10 per 30 s");
    expect(formatPricePer30s(0)).toBe("$0.00 per 30 s");
    expect(formatPricePer30s(null)).toBeNull();
    expect(formatPricePer30s(undefined)).toBeNull();
    expect(formatPricePer30s(Number.NaN)).toBeNull();
    expect(formatPricePer30s(-1)).toBeNull();
  });
});
