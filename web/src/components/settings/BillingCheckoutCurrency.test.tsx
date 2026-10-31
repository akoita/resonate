import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The containers' hooks are driven by hand (no DOM here): record state and
// effects in slots, call the section as a function and read the props it hands
// to its pure view, which is where the handlers live.
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
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
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

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class extends Error {
    details: unknown;
    constructor(details: unknown) {
      super("api error");
      this.details = details;
    }
  },
}));

const getBillingState = vi.fn();
const startSubscriptionCheckout = vi.fn();
const getCreditTopUpState = vi.fn();
const startCreditCheckout = vi.fn();
vi.mock("../../lib/api", () => ({
  ApiRequestError: FakeApiError,
  getBillingState: (...args: unknown[]) => getBillingState(...args),
  openBillingPortal: vi.fn(),
  startSubscriptionCheckout: (...args: unknown[]) => startSubscriptionCheckout(...args),
  getCreditTopUpState: (...args: unknown[]) => getCreditTopUpState(...args),
  startCreditCheckout: (...args: unknown[]) => startCreditCheckout(...args),
  deliverHeldCreditsNow: vi.fn(),
}));

import type { BillingCurrency, BillingState, CreditTopUpState } from "../../lib/api";
import { BuyCreditsSection, type BuyCreditsViewProps } from "./BuyCredits";
import { PlanBillingSection, type PlanBillingViewProps } from "./PlanBilling";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function billingState(currencies: BillingCurrency[]): BillingState {
  return {
    available: true,
    testMode: false,
    contactEmailConfirmed: true,
    currencies,
    prices: { month: { usd: 1499, eur: 1499 }, year: { usd: 14990, eur: 14990 } },
    hasBillingAccount: false,
    plan: { plan: "free" },
    subscription: null,
    consent: {
      version: "v1",
      reviewStatus: "reviewed",
      heading: "h",
      intro: "i",
      acknowledgement: "a",
      cancellation: "c",
      confirmation: "x",
    },
  };
}

function creditState(currencies: BillingCurrency[]): CreditTopUpState {
  return {
    available: true,
    testMode: false,
    contactEmailConfirmed: true,
    currencies,
    packs: [
      { id: "credits_10", prices: { usd: 1000, eur: 1000 }, creditsCents: 1000, isDefault: true },
      { id: "credits_25", prices: { usd: 2500, eur: 2500 }, creditsCents: 2500, isDefault: false },
    ],
    defaultPackId: "credits_10",
    heldCents: 0,
    purchases: [],
    consent: {
      version: "c1",
      reviewStatus: "reviewed",
      heading: "h",
      intro: "i",
      deliverNow: { label: "Now", description: "d", acknowledgement: "a" },
      wait: { label: "Wait", description: "d" },
      mint: { explanation: "m" },
      confirmation: "x",
    },
  } as CreditTopUpState;
}

type Preference = BillingCurrency | null;
const toast = vi.fn();
const assign = vi.fn();

function renderPlan(preference: Preference) {
  slotIndex = 0;
  pendingEffects.length = 0;
  const element = PlanBillingSection({
    token: "t",
    addToast: toast,
    currencyPreference: preference,
  }) as React.ReactElement<PlanBillingViewProps>;
  pendingEffects.splice(0).forEach((run) => run());
  return element.props;
}

function renderCredits(preference: Preference) {
  slotIndex = 0;
  pendingEffects.length = 0;
  const element = BuyCreditsSection({
    token: "t",
    addToast: toast,
    currencyPreference: preference,
  }) as React.ReactElement<BuyCreditsViewProps>;
  pendingEffects.splice(0).forEach((run) => run());
  return element.props;
}

describe("checkout names the currency the person was shown (#2496)", () => {
  beforeEach(() => {
    slots.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { search: "", href: "https://app.test/settings", assign },
      history: { replaceState: vi.fn() },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function subscribe(preference: Preference, offered: BillingCurrency[]) {
    getBillingState.mockResolvedValue(billingState(offered));
    startSubscriptionCheckout.mockResolvedValue({ url: "https://stripe.test/pay" });
    renderPlan(preference);
    await flush();
    renderPlan(preference).onChoose?.("month");
    renderPlan(preference).onAcknowledge?.(true);
    await renderPlan(preference).onContinue?.();
  }

  it("subscription: sends eur when euros are chosen and offered", async () => {
    await subscribe("eur", ["usd", "eur"]);
    expect(startSubscriptionCheckout).toHaveBeenCalledWith("t", expect.objectContaining({ interval: "month", currency: "eur" }));
    expect(assign).toHaveBeenCalledWith("https://stripe.test/pay");
    expect(renderPlan("eur").currency).toBe("eur");
  });

  it("subscription: sends usd when EUR is not offered, even if euros were chosen before", async () => {
    await subscribe("eur", ["usd"]);
    expect(startSubscriptionCheckout).toHaveBeenCalledWith("t", expect.objectContaining({ currency: "usd" }));
  });

  it("subscription: explains currency_unavailable", async () => {
    getBillingState.mockResolvedValue(billingState(["usd", "eur"]));
    startSubscriptionCheckout.mockRejectedValue(new FakeApiError({ code: "currency_unavailable" }));
    renderPlan("eur");
    await flush();
    renderPlan("eur").onChoose?.("year");
    renderPlan("eur").onAcknowledge?.(true);
    await renderPlan("eur").onContinue?.();
    expect(startSubscriptionCheckout).toHaveBeenCalledWith("t", expect.objectContaining({ interval: "year", currency: "eur" }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Prices in this currency are not available yet. Reload and try again." }),
    );
  });

  async function buy(preference: Preference, offered: BillingCurrency[]) {
    getCreditTopUpState.mockResolvedValue(creditState(offered));
    startCreditCheckout.mockResolvedValue({ url: "https://stripe.test/credits" });
    renderCredits(preference);
    await flush();
    renderCredits(preference).onOpenConsent?.();
    renderCredits(preference).onConsentChange?.({ choice: "wait", acknowledged: false });
    await renderCredits(preference).onContinue?.();
  }

  it("credits: sends eur with the pack when euros are chosen and offered", async () => {
    await buy("eur", ["usd", "eur"]);
    expect(startCreditCheckout).toHaveBeenCalledWith(
      "t",
      expect.objectContaining({ packId: "credits_10", currency: "eur" }),
    );
    expect(assign).toHaveBeenCalledWith("https://stripe.test/credits");
  });

  it("credits: automatic choice outside the EU time zones sends usd", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      timeZone: "America/New_York",
    } as Intl.ResolvedDateTimeFormatOptions);
    await buy(null, ["usd", "eur"]);
    expect(startCreditCheckout).toHaveBeenCalledWith("t", expect.objectContaining({ currency: "usd" }));
    vi.restoreAllMocks();
  });

  it("credits: explains currency_unavailable", async () => {
    getCreditTopUpState.mockResolvedValue(creditState(["usd", "eur"]));
    startCreditCheckout.mockRejectedValue(new FakeApiError({ code: "currency_unavailable" }));
    renderCredits("eur");
    await flush();
    renderCredits("eur").onOpenConsent?.();
    renderCredits("eur").onConsentChange?.({ choice: "wait", acknowledged: false });
    await renderCredits("eur").onContinue?.();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Prices in this currency are not available yet. Reload and try again." }),
    );
  });
});
