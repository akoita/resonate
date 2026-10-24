import {
  decidePurchaseDelivery,
  earliestHold,
  type ConsentForDecision,
} from "../modules/purchase_consent/purchase_consent_delivery";
import { PURCHASE_CONSENT_EFFECTIVE_AT, WITHDRAWAL_PERIOD_MS } from "../modules/purchase_consent/purchase_consent.constants";

const DAY = 24 * 60 * 60 * 1000;
const purchasedAt = new Date("2026-11-01T12:00:00Z");
const HASH = `0x${"a".repeat(64)}`;

function consent(overrides: Partial<ConsentForDecision> = {}): ConsentForDecision {
  return {
    id: "c1",
    surface: "stem_purchase",
    subjectId: "stem-1",
    consented: true,
    acknowledgedWaiver: true,
    transactionHash: null,
    purchaseRef: null,
    createdAt: new Date(purchasedAt.getTime() - 60_000),
    ...overrides,
  };
}

const request = { surface: "stem_purchase" as const, subjectId: "stem-1", purchasedAt, refs: [HASH] };

describe("decidePurchaseDelivery (#1776)", () => {
  const justBefore = new Date(PURCHASE_CONSENT_EFFECTIVE_AT.getTime() - 1);
  const duringHold = new Date(PURCHASE_CONSENT_EFFECTIVE_AT.getTime() + DAY);

  it("delivers a purchase made before the consent step as before, with no consent", () => {
    const decision = decidePurchaseDelivery({ ...request, purchasedAt: justBefore }, [], duringHold);
    expect(decision).toEqual({ state: "released", basis: "predates_consent", consentId: null });
  });

  it("holds a purchase made exactly at the cutover when there is no consent", () => {
    const decision = decidePurchaseDelivery(
      { ...request, purchasedAt: PURCHASE_CONSENT_EFFECTIVE_AT },
      [],
      duringHold,
    );
    expect(decision).toMatchObject({
      state: "held",
      availableAt: new Date(PURCHASE_CONSENT_EFFECTIVE_AT.getTime() + WITHDRAWAL_PERIOD_MS),
    });
  });

  it("holds a purchase after the cutover when there is no consent", () => {
    const after = new Date(PURCHASE_CONSENT_EFFECTIVE_AT.getTime() + 60_000);
    expect(decidePurchaseDelivery({ ...request, purchasedAt: after }, [], duringHold).state).toBe("held");
  });

  it("holds a purchase with no consent until 14 days after the purchase", () => {
    const decision = decidePurchaseDelivery(request, [], new Date(purchasedAt.getTime() + DAY));
    expect(decision).toEqual({
      state: "held",
      availableAt: new Date(purchasedAt.getTime() + WITHDRAWAL_PERIOD_MS),
      consentId: null,
    });
  });

  it("releases a purchase once the withdrawal period has elapsed", () => {
    const decision = decidePurchaseDelivery(request, [], new Date(purchasedAt.getTime() + 14 * DAY));
    expect(decision).toMatchObject({ state: "released", basis: "hold_elapsed" });
  });

  it("releases immediately against a consent with the waiver acknowledged", () => {
    const decision = decidePurchaseDelivery(request, [consent()], new Date(purchasedAt.getTime() + 1000));
    expect(decision).toEqual({ state: "released", basis: "consent", consentId: "c1" });
  });

  it("keeps holding when the buyer chose to wait", () => {
    const wait = consent({ consented: false, acknowledgedWaiver: false });
    const decision = decidePurchaseDelivery(request, [wait], new Date(purchasedAt.getTime() + DAY));
    expect(decision).toMatchObject({ state: "held", consentId: "c1" });
  });

  it("does not accept consent without the acknowledgement", () => {
    const decision = decidePurchaseDelivery(
      request,
      [consent({ acknowledgedWaiver: false })],
      new Date(purchasedAt.getTime() + DAY),
    );
    expect(decision.state).toBe("held");
  });

  it("lets a later consent release a held purchase (delivery has not begun)", () => {
    const later = consent({ createdAt: new Date(purchasedAt.getTime() + 3 * DAY) });
    const decision = decidePurchaseDelivery(request, [later], new Date(purchasedAt.getTime() + 4 * DAY));
    expect(decision).toMatchObject({ state: "released", basis: "consent" });
  });

  it("ignores a stale unlinked consent recorded long before the purchase", () => {
    const stale = consent({ createdAt: new Date(purchasedAt.getTime() - 3 * DAY) });
    expect(decidePurchaseDelivery(request, [stale], purchasedAt).state).toBe("held");
  });

  it("applies a consent linked to this payment and never one linked to another", () => {
    const mine = consent({ transactionHash: HASH.toUpperCase().replace("0X", "0x") });
    const other = consent({ id: "c2", transactionHash: `0x${"b".repeat(64)}` });
    expect(decidePurchaseDelivery(request, [mine], purchasedAt).state).toBe("released");
    expect(decidePurchaseDelivery(request, [other], purchasedAt).state).toBe("held");
  });

  it("never applies a consent for another item or surface", () => {
    expect(decidePurchaseDelivery(request, [consent({ subjectId: "stem-2" })], purchasedAt).state).toBe("held");
    expect(decidePurchaseDelivery(request, [consent({ surface: "punchline_collect" })], purchasedAt).state).toBe("held");
  });

  it("earliestHold is null when any purchase is released", () => {
    const held = decidePurchaseDelivery(request, [], purchasedAt);
    const released = decidePurchaseDelivery(request, [consent()], purchasedAt);
    expect(earliestHold([held, released])).toBeNull();
    expect(earliestHold([held])).toEqual(new Date(purchasedAt.getTime() + WITHDRAWAL_PERIOD_MS));
  });
});
