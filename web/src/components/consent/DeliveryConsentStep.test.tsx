import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../lib/api", () => ({
  getPurchaseConsentWording: vi.fn(),
  recordPurchaseConsent: vi.fn(),
}));

import { DeliveryConsentStep } from "./DeliveryConsentStep";
import { INITIAL_DELIVERY_CONSENT } from "./deliveryConsent";

const wording = {
  version: "v-test",
  reviewStatus: "for_legal_review_before_production",
  heading: "Delivery and your right to withdraw",
  intro: "Intro text.",
  deliverNow: { label: "Deliver now", description: "Right away.", acknowledgement: "I lose my right to withdraw." },
  wait: { label: "Wait 14 days", description: "Keep your right." },
  mint: { explanation: "Minting cannot be undone." },
  confirmation: "We confirm it in your notices.",
};

describe("DeliveryConsentStep (#1776)", () => {
  it("shows a loading state until the wording arrives", () => {
    const html = renderToStaticMarkup(
      <DeliveryConsentStep wording={null} state={INITIAL_DELIVERY_CONSENT} onChange={() => {}} />,
    );
    expect(html).toContain("Loading delivery terms");
  });

  it("shows both choices unselected and no acknowledgement box", () => {
    const html = renderToStaticMarkup(
      <DeliveryConsentStep wording={wording} state={INITIAL_DELIVERY_CONSENT} onChange={() => {}} />,
    );
    expect(html).toContain("Deliver now");
    expect(html).toContain("Wait 14 days");
    expect(html).not.toContain("checked");
    expect(html).not.toContain("I lose my right to withdraw.");
    expect(html).toContain("Nothing is selected for you");
    expect(html).toContain("for legal review before production");
  });

  it("asks for an unticked acknowledgement once deliver now is chosen", () => {
    const html = renderToStaticMarkup(
      <DeliveryConsentStep
        wording={wording}
        state={{ choice: "deliver_now", acknowledged: false }}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("I lose my right to withdraw.");
    expect(html).toContain("Choose one to continue");
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it("offers only deliver now, with the reason, for a mint", () => {
    const html = renderToStaticMarkup(
      <DeliveryConsentStep wording={wording} state={INITIAL_DELIVERY_CONSENT} onChange={() => {}} mintOnly />,
    );
    expect(html).toContain("Minting cannot be undone.");
    expect(html).not.toContain("Wait 14 days");
  });

  it("explains a wording failure instead of letting the buyer pay blind", () => {
    const html = renderToStaticMarkup(
      <DeliveryConsentStep wording={null} error="We could not load the delivery terms." state={INITIAL_DELIVERY_CONSENT} onChange={() => {}} />,
    );
    expect(html).toContain("We could not load the delivery terms.");
    expect(html).toContain('role="alert"');
  });
});
