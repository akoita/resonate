import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  X402QuoteBreakdown,
  isConsumedOnchainListing,
  showLegacyNativeWarning,
} from "./BuyModal";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SELLER = "0x46213007a5e229d789f74b408625dda265e00c28";
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

const liveUsdcListing = {
  seller: SELLER,
  amount: 1n,
  paymentToken: USDC,
};

// A consumed listing reads back from the contract as a zeroed struct (#1172).
const consumedListing = {
  seller: ZERO_ADDRESS,
  amount: 0n,
  paymentToken: ZERO_ADDRESS,
};

describe("isConsumedOnchainListing (#1172)", () => {
  it("flags the zeroed struct a consumed listing reads back as", () => {
    expect(isConsumedOnchainListing(consumedListing)).toBe(true);
  });

  it("flags a sold-out listing (zero amount, real seller)", () => {
    expect(
      isConsumedOnchainListing({ seller: SELLER, amount: 0n }),
    ).toBe(true);
  });

  it("does not flag a live listing", () => {
    expect(isConsumedOnchainListing(liveUsdcListing)).toBe(false);
  });

  it("does not flag a missing listing (loading/none is a separate state)", () => {
    expect(isConsumedOnchainListing(null)).toBe(false);
    expect(isConsumedOnchainListing(undefined)).toBe(false);
  });
});

describe("showLegacyNativeWarning (#1172)", () => {
  it("warns for a live native-ETH listing when stablecoin checkout is configured", () => {
    expect(
      showLegacyNativeWarning(
        { seller: SELLER, amount: 1n, paymentToken: ZERO_ADDRESS },
        true,
      ),
    ).toBe(true);
  });

  it("never warns for the consumed-listing phantom, even though its paymentToken reads 0x0", () => {
    expect(showLegacyNativeWarning(consumedListing, true)).toBe(false);
  });

  it("does not warn for a live stablecoin listing", () => {
    expect(showLegacyNativeWarning(liveUsdcListing, true)).toBe(false);
  });

  it("does not warn when no stablecoin marketplace asset is configured", () => {
    expect(
      showLegacyNativeWarning(
        { seller: SELLER, amount: 1n, paymentToken: ZERO_ADDRESS },
        false,
      ),
    ).toBe(false);
  });
});

describe("X402QuoteBreakdown (#1581)", () => {
  it("shows the backend fee as included and does not add it to total", () => {
    const html = renderToStaticMarkup(
      <X402QuoteBreakdown
        loading={false}
        quote={{
          totalAmount: "10.25",
          totalCurrency: "USDC",
          amountUsd: 10.25,
          amountUnits: "10250000",
          payTo: SELLER,
          platformFee: { amount: "1.025", currency: "USDC", feeBps: 1000 },
        }}
      />,
    );
    expect(html).toContain("Platform fee (included)");
    expect(html).toContain("1.025 USDC");
    expect(html).toContain("Total");
    expect(html).toContain("10.25 USDC");
    expect(html).not.toContain("11.275 USDC");
  });

  it("renders an explicit unavailable state without guessed amounts", () => {
    const html = renderToStaticMarkup(
      <X402QuoteBreakdown loading={false} quote={null} />,
    );
    expect(html).toContain("Quote details unavailable");
    expect(html).toContain("Unavailable");
  });
});
