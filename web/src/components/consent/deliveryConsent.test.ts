import { beforeEach, describe, expect, it, vi } from "vitest";

const recordPurchaseConsent = vi.fn();
vi.mock("../../lib/api", () => ({
  getPurchaseConsentWording: vi.fn(),
  recordPurchaseConsent: (...args: unknown[]) => recordPurchaseConsent(...args),
}));

import {
  INITIAL_DELIVERY_CONSENT,
  isDeliveryConsentComplete,
  recordDeliveryChoice,
  selectDeliveryChoice,
} from "./deliveryConsent";

const wording = { version: "v-test" } as never;

describe("delivery consent step state (#1776)", () => {
  beforeEach(() => recordPurchaseConsent.mockReset());

  it("starts with nothing chosen and nothing ticked", () => {
    expect(INITIAL_DELIVERY_CONSENT).toEqual({ choice: null, acknowledged: false });
    expect(isDeliveryConsentComplete(INITIAL_DELIVERY_CONSENT)).toBe(false);
  });

  it("deliver now needs the explicit acknowledgement", () => {
    const chosen = selectDeliveryChoice(INITIAL_DELIVERY_CONSENT, "deliver_now");
    expect(isDeliveryConsentComplete(chosen)).toBe(false);
    expect(isDeliveryConsentComplete({ ...chosen, acknowledged: true })).toBe(true);
  });

  it("wait is complete on its own and clears any acknowledgement", () => {
    const waited = selectDeliveryChoice({ choice: "deliver_now", acknowledged: true }, "wait");
    expect(waited).toEqual({ choice: "wait", acknowledged: false });
    expect(isDeliveryConsentComplete(waited)).toBe(true);
  });

  it("a mint never accepts wait", () => {
    expect(isDeliveryConsentComplete({ choice: "wait", acknowledged: false }, { mintOnly: true })).toBe(false);
    expect(isDeliveryConsentComplete({ choice: "deliver_now", acknowledged: true }, { mintOnly: true })).toBe(true);
  });

  it("records the waiver acknowledgement with deliver now", async () => {
    recordPurchaseConsent.mockResolvedValue({ id: "c1" });
    await recordDeliveryChoice("tok", wording, { choice: "deliver_now", acknowledged: true }, {
      surface: "stem_purchase",
      subjectId: "stem-1",
      licenseType: "remix",
    });
    expect(recordPurchaseConsent).toHaveBeenCalledWith("tok", {
      surface: "stem_purchase",
      subjectId: "stem-1",
      licenseType: "remix",
      consented: true,
      acknowledgedWaiver: true,
      textVersion: "v-test",
    });
  });

  it("records a wait choice without a waiver", async () => {
    recordPurchaseConsent.mockResolvedValue({ id: "c2" });
    await recordDeliveryChoice("tok", wording, { choice: "wait", acknowledged: false }, {
      surface: "punchline_collect",
      subjectId: "m1",
    });
    expect(recordPurchaseConsent).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ consented: false, acknowledgedWaiver: false }),
    );
  });

  it("refuses to record an incomplete choice, so the payment never starts", async () => {
    await expect(
      recordDeliveryChoice("tok", wording, { choice: "deliver_now", acknowledged: false }, {
        surface: "stem_purchase",
        subjectId: "stem-1",
      }),
    ).rejects.toThrow(/Choose how/);
    expect(recordPurchaseConsent).not.toHaveBeenCalled();
  });
});
