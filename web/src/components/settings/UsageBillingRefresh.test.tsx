import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Effects never run in a server render, so record them and run them by hand.
// Hooks keep call-order slots across the repeated renders a test performs, and
// effects and callbacks honor their dependency lists, so a test can tell "runs
// on mount only" from "runs again when a dependency changes".
const slots: unknown[] = [];
let slotIndex = 0;
const pendingEffects: Array<() => void | (() => void)> = [];
const depsChanged = (previous: unknown[] | undefined, next: unknown[] | undefined) =>
  !previous || !next || previous.length !== next.length || previous.some((value, i) => !Object.is(value, next[i]));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = slotIndex++;
      if (!(index in slots)) {
        slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (previous: T) => T)(slots[index] as T) : next;
      };
      return [slots[index] as T, setState] as const;
    },
    useRef: <T,>(initial: T) => {
      const index = slotIndex++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useCallback: <T,>(fn: T, deps?: unknown[]) => {
      const index = slotIndex++;
      const slot = slots[index] as { fn: T; deps?: unknown[] } | undefined;
      if (!slot || depsChanged(slot.deps, deps)) slots[index] = { fn, deps };
      return (slots[index] as { fn: T }).fn;
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const index = slotIndex++;
      const slot = slots[index] as { deps?: unknown[] } | undefined;
      if (!slot || depsChanged(slot.deps, deps)) {
        slots[index] = { deps };
        pendingEffects.push(fn);
      }
    },
  };
});

const buttons: Record<string, (() => void) | undefined> = {};
vi.mock("../ui/Button", () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => {
    if (typeof children === "string") buttons[children] = onClick;
    return <button type="button">{children}</button>;
  },
}));

const getUsageSummary = vi.fn();
const getBillingState = vi.fn();
const getCreditTopUpState = vi.fn();
vi.mock("../../lib/api", () => ({
  ApiRequestError: class extends Error {},
  getUsageSummary: (...args: unknown[]) => getUsageSummary(...args),
  requestGenerationCredits: vi.fn(),
  getBillingState: (...args: unknown[]) => getBillingState(...args),
  openBillingPortal: vi.fn(),
  startSubscriptionCheckout: vi.fn(),
  getCreditTopUpState: (...args: unknown[]) => getCreditTopUpState(...args),
  startCreditCheckout: vi.fn(),
  deliverHeldCreditsNow: vi.fn(),
}));

import type { UsageSummary } from "../../lib/api";
import UsageBillingPanel from "./UsageBillingPanel";

const SUMMARY = {
  credits: { balanceCents: 100, priceCentsPer30s: 10, recentTransactions: [] },
  limits: [],
  breakdown: { periodDays: 30, since: "2026-10-01T00:00:00.000Z", items: [] },
  plan: { tier: "pro", source: "stripe_subscription", validUntil: "2026-11-07T00:00:00.000Z", monthlyAllowanceCents: 300 },
} as unknown as UsageSummary;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Render the panel, then run the effects whose dependencies changed and let their fetches settle. */
async function renderAndSettle() {
  slotIndex = 0;
  pendingEffects.length = 0;
  const html = renderToStaticMarkup(<UsageBillingPanel token="token" addToast={vi.fn()} />);
  pendingEffects.splice(0).forEach((run) => run());
  await flush();
  return html;
}

describe("UsageBillingPanel Refresh (#2494)", () => {
  beforeEach(() => {
    slots.length = 0;
    vi.clearAllMocks();
    getUsageSummary.mockResolvedValue(SUMMARY);
    getBillingState.mockRejectedValue(new Error("not needed"));
    getCreditTopUpState.mockRejectedValue(new Error("not needed"));
  });

  it("re-reads the subscription and the credit packs, not only the usage summary", async () => {
    await renderAndSettle();
    expect(getUsageSummary).toHaveBeenCalledTimes(1);

    // The summary arrived: the Plan and Credits sections mount and load once.
    await renderAndSettle();
    expect(getBillingState).toHaveBeenCalledTimes(1);
    expect(getCreditTopUpState).toHaveBeenCalledTimes(1);

    // A plain re-render does not fetch again.
    await renderAndSettle();
    expect(getBillingState).toHaveBeenCalledTimes(1);
    expect(getCreditTopUpState).toHaveBeenCalledTimes(1);

    buttons.Refresh?.();
    await flush();
    expect(getUsageSummary).toHaveBeenCalledTimes(2);

    await renderAndSettle();
    expect(getBillingState).toHaveBeenCalledTimes(2);
    expect(getCreditTopUpState).toHaveBeenCalledTimes(2);
  });
});
