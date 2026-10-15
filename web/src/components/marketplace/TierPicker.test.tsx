import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TierPicker } from "./TierPicker";
import { initialTierDrafts, validateTierDrafts } from "../../lib/multiTierListing";

describe("TierPicker", () => {
  it("shows all three tiers with price and edition inputs only for selected tiers", () => {
    const drafts = initialTierDrafts({ personalPrice: "1", asset: null });
    drafts.remix = { ...drafts.remix, selected: true };
    const html = renderToStaticMarkup(
      <TierPicker value={drafts} onChange={() => {}} assetSymbol="USDC" priceStep="0.000001" idPrefix="t" />,
    );
    expect(html).toContain("License tiers");
    expect(html).toContain("Personal (NFT)");
    expect(html).toContain("Remix License");
    expect(html).toContain("Commercial License");
    expect(html).toContain('id="t-personal-price"');
    expect(html).toContain('id="t-remix-amount"');
    expect(html).not.toContain('id="t-commercial-price"');
    expect(html).toContain("USDC per edition");
    expect(html).toContain("A remix license is what unlocks Remix Studio for this stem.");
  });

  it("renders inline validation errors and the plan summary", () => {
    const drafts = initialTierDrafts({ personalPrice: "0", asset: null });
    drafts.personal = { ...drafts.personal, amount: "0" };
    const validated = validateTierDrafts(drafts, { asset: null });
    const html = renderToStaticMarkup(
      <TierPicker
        value={drafts}
        onChange={() => {}}
        errors={validated.errors}
        formError={validated.formError}
        assetSymbol="ETH"
        priceStep="0.000000000000000001"
        summary={<span>Lists 1 license tier</span>}
      />,
    );
    expect(html).toContain("Price must be greater than zero.");
    expect(html).toContain("At least 1 edition.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Lists 1 license tier");
  });
});
