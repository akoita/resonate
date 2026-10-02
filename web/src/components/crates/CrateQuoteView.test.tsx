import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CrateDroppedList,
  CrateQuoteReceipts,
  CrateQuoteView,
  type CrateQuoteViewProps,
} from "./CrateQuoteView";
import { choicesFromQuote } from "../../lib/crateQuote";
import type { CrateItemDto } from "../../lib/crates";
import {
  NOW_MS,
  makeQuote,
  quoteItem,
  quoteLine,
} from "../../lib/__tests__/crateQuoteFixtures";

function crateItem(trackId: string, overrides: Partial<CrateItemDto> = {}): CrateItemDto {
  return {
    position: 0,
    locked: false,
    trackId,
    title: `Track ${trackId}`,
    artistId: null,
    artistName: "Nova",
    available: true,
    tempoBpm: 124,
    camelot: "8A",
    energy: 0.5,
    stemTypes: ["vocals", "drums", "bass"],
    listedLicenseTypes: ["personal", "remix"],
    indicativePriceUsd: {},
    linePriceUsd: null,
    verifiedHuman: true,
    aiDisclosureLevel: "NONE",
    transitionToNext: null,
    originalStemId: null,
    stems: [
      { type: "vocals", qualityScore: null },
      { type: "drums", qualityScore: null },
      { type: "bass", qualityScore: null },
    ],
    licenseOptions: [
      { licenseType: "personal", listed: true, indicativePriceUsd: 1, standardTerms: true, grants: [] },
      { licenseType: "remix", listed: true, indicativePriceUsd: 2, standardTerms: true, grants: [] },
      { licenseType: "sync", listed: false, indicativePriceUsd: null, standardTerms: false, grants: [] },
    ],
    ...overrides,
  };
}

function render(props: Partial<CrateQuoteViewProps> = {}) {
  const quote = props.quote ?? makeQuote();
  return renderToStaticMarkup(
    <CrateQuoteView
      quote={quote}
      crateItems={[crateItem("t1"), crateItem("t2")]}
      choices={choicesFromQuote(quote)}
      nowMs={NOW_MS}
      {...props}
    />,
  );
}

describe("CrateQuoteView", () => {
  it("shows each track with its tier, rights, stems, prices, artist side and platform fee", () => {
    const html = render();
    expect(html).toContain("Track t1");
    expect(html).toContain("License for Track t1");
    expect(html).toContain("Use in derivative works, publish remixes");
    expect(html).toContain("Includes personal rights");
    expect(html).toContain("Stems for Track t1");
    expect(html).toContain("2 USDC (about $2.00)");
    expect(html).toContain("Artist side 1.8 USDC");
    expect(html).toContain("Platform fee 0.2 USDC");
    // The tiers on offer: the listed ones, not the unlisted sync tier.
    expect(html).toContain(">Personal</option>");
    expect(html).toContain(">Remix</option>");
    expect(html).not.toContain(">Sync</option>");
  });

  it("explains a dropped stem in plain words and keeps it out of the price", () => {
    const quote = makeQuote({
      lines: [
        quoteLine("t1", [
          quoteItem("q1", { stemType: "drums" }),
          quoteItem("q2", {
            stemType: "vocals",
            status: "dropped",
            reason: "sold_out",
            listingId: null,
            totalUnits: null,
            total: null,
            totalUsd: null,
            artistShareUnits: null,
            platformFeeUnits: null,
          }),
        ]),
      ],
    });
    const html = render({ quote });
    expect(html).toContain("Not in this quote: Sold out");
    expect(html).toContain('data-status="dropped"');
  });

  it("shows totals per token and in USD, and the budget warning only when over", () => {
    const quote = makeQuote({
      totals: [
        { paymentToken: "0xa", symbol: "USDC", decimals: 6, totalUnits: "7000000", total: "7", totalUsd: "7" },
        { paymentToken: "0xb", symbol: "ETH", decimals: 18, totalUnits: "1000000000000000", total: "0.001", totalUsd: "3.5" },
      ],
      totalUsd: "10.5",
      budgetUsd: 10,
      overBudget: true,
    });
    const html = render({ quote });
    expect(html).toContain("Total in USDC");
    expect(html).toContain("7 USDC (about $7.00)");
    expect(html).toContain("0.001 ETH (about $3.50)");
    expect(html).toContain("Total in USD");
    expect(html).toContain("$10.50");
    expect(html).toContain("Over your $10.00 budget");

    expect(render()).not.toContain("budget");
  });

  it("counts down while the quote is live and asks for a new one once it has expired", () => {
    expect(render()).toContain("Prices are good for 9:41");
    expect(render()).toContain('data-expired="false"');
    const expired = render({ nowMs: NOW_MS + 11 * 60_000 });
    expect(expired).toContain("This quote has expired. Get a new quote.");
    expect(expired).toContain('data-expired="true"');
    // Nothing can be changed on an expired quote.
    expect(expired).toContain("disabled");
  });

  it("says so when a tier has no standard terms", () => {
    const quote = makeQuote({
      lines: [
        quoteLine("t1", [quoteItem("q1")], {
          licenseType: "sync",
          rights: { licenseType: "sync", standardTerms: false, grants: [] },
        }),
      ],
    });
    expect(render({ quote })).toContain("No standard terms yet");
  });

  it("does not let the last stem of a line be switched off", () => {
    const quote = makeQuote({ lines: [quoteLine("t1", [quoteItem("q1", { stemType: "vocals" })])] });
    const html = render({ quote });
    expect(html).toMatch(/<input type="checkbox" checked="" disabled=""/);
  });
});

describe("CrateDroppedList", () => {
  it("names each left-out stem with its reason", () => {
    const html = renderToStaticMarkup(
      <CrateDroppedList
        quote={makeQuote()}
        dropped={[
          { quoteLineId: "q2", reason: "listing_changed" },
          { quoteLineId: "q3", reason: "insufficient_balance" },
        ]}
      />,
    );
    expect(html).toContain("Track t1: Vocals");
    expect(html).toContain("Left out: the listing changed");
    expect(html).toContain("Track t2: Bass");
    expect(html).toContain("Left out: not enough balance");
  });
});

describe("CrateQuoteReceipts", () => {
  const hash = `0x${"ab".repeat(32)}`;

  it("renders nothing for a quote that was never sent", () => {
    expect(renderToStaticMarkup(<CrateQuoteReceipts quote={makeQuote()} />)).toBe("");
  });

  it("shows settled, failed and left-out stems with their reasons and transaction", () => {
    const quote = makeQuote({
      status: "partial",
      transactionHash: hash,
      lines: [
        quoteLine("t1", [
          quoteItem("q1", {
            status: "settled",
            stemType: "drums",
            receipt: { transactionHash: hash, logIndex: 1, totalPaidUnits: "2000000", purchaseId: null },
          }),
          quoteItem("q2", { status: "dropped", reason: "simulation_failed", stemType: "vocals" }),
          quoteItem("q3", { status: "failed", reason: "not_in_transaction", stemType: "bass" }),
        ]),
      ],
    });
    const html = renderToStaticMarkup(<CrateQuoteReceipts quote={quote} />);
    expect(html).toContain("Receipts");
    expect(html).toContain("Bought 1 stem.");
    expect(html).toContain("not bought and you were not charged");
    expect(html).toContain("Bought for 2 USDC");
    expect(html).toContain("Left out");
    expect(html).toContain("Left out: it would have failed");
    expect(html).toContain("Not bought");
    expect(html).toContain("Not part of the purchase");
    expect(html).toContain("Transaction 0xababab");
  });

  it("says nothing was bought when the transaction failed", () => {
    const quote = makeQuote({
      status: "failed",
      transactionHash: hash,
      lines: [quoteLine("t1", [quoteItem("q1", { status: "failed", reason: "transaction_reverted" })])],
    });
    const html = renderToStaticMarkup(<CrateQuoteReceipts quote={quote} />);
    expect(html).toContain("Nothing was bought.");
    expect(html).toContain("The purchase did not go through");
  });

  it("shows a quote that is still confirming", () => {
    const html = renderToStaticMarkup(
      <CrateQuoteReceipts quote={makeQuote({ status: "submitted", transactionHash: hash })} />,
    );
    expect(html).toContain("Still confirming your purchase.");
  });
});
