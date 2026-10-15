import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PurchaseSuccessPanel,
  X402QuoteBreakdown,
  isConsumedOnchainListing,
  resolveBuyModalView,
  showLegacyNativeWarning,
  type CompletedPurchase,
} from "./BuyModal";
import type { X402PaymentResult } from "../../lib/x402Pay";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ token: "jwt-token" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

describe("resolveBuyModalView (#2042)", () => {
  const onchain: CompletedPurchase = { method: "onchain", licenseType: "remix", txHash: "0xabc" };

  it("shows the success view once a purchase finished, whatever the listing does next", () => {
    expect(resolveBuyModalView({ completed: onchain, listingLoading: false, hasListing: true, consumed: false })).toBe("success");
    // The bought listing sold out, is reloading, or disappeared: still success.
    expect(resolveBuyModalView({ completed: onchain, listingLoading: false, hasListing: true, consumed: true })).toBe("success");
    expect(resolveBuyModalView({ completed: onchain, listingLoading: true, hasListing: false, consumed: false })).toBe("success");
    expect(resolveBuyModalView({ completed: onchain, listingLoading: false, hasListing: false, consumed: false })).toBe("success");
  });

  it("keeps the pre-purchase views otherwise", () => {
    expect(resolveBuyModalView({ completed: null, listingLoading: true, hasListing: false, consumed: false })).toBe("loading");
    expect(resolveBuyModalView({ completed: null, listingLoading: false, hasListing: true, consumed: true })).toBe("consumed");
    expect(resolveBuyModalView({ completed: null, listingLoading: false, hasListing: true, consumed: false })).toBe("listing");
    expect(resolveBuyModalView({ completed: null, listingLoading: false, hasListing: false, consumed: false })).toBe("not_found");
  });
});

describe("PurchaseSuccessPanel (#2042)", () => {
  it("shows Done and the handoff, and no purchase control, after a wallet purchase", () => {
    const html = renderToStaticMarkup(
      <PurchaseSuccessPanel
        completed={{ method: "onchain", licenseType: "remix", txHash: "0xabc" }}
        trackId="track-1"
        stemId="stem-1"
        onDone={() => {}}
      />,
    );
    expect(html).toContain("Purchase successful!");
    expect(html).toContain(">Done<");
    expect(html).toContain('href="/library?tab=stems"');
    expect(html).toContain("Open in Remix Studio");
    expect(html).not.toContain("Confirm wallet purchase");
    expect(html).not.toContain("Cancel");
    expect(html).not.toContain("Pay ");
  });

  it("offers only the library after a personal wallet purchase", () => {
    const html = renderToStaticMarkup(
      <PurchaseSuccessPanel
        completed={{ method: "onchain", licenseType: "personal", txHash: "0xabc" }}
        trackId="track-1"
        onDone={() => {}}
      />,
    );
    expect(html).toContain("View in your library");
    expect(html).not.toContain("Open in Remix Studio");
  });

  function x402Result(status: "contract_backed" | "download_only"): X402PaymentResult {
    return {
      audio: new Blob(["x"]),
      filename: "stem.mp3",
      receiptId: "r-1",
      receipt: { settlement: { status } },
    } as unknown as X402PaymentResult;
  }

  it("links the library after an x402 payment settled through the marketplace", () => {
    const html = renderToStaticMarkup(
      <PurchaseSuccessPanel
        completed={{ method: "x402", licenseType: "personal", result: x402Result("contract_backed") }}
        x402DownloadUrl="blob:stem"
        onDone={() => {}}
      />,
    );
    expect(html).toContain("Payment settled.");
    expect(html).toContain("Download stem");
    expect(html).toContain("View in your library");
    expect(html).toContain(">Done<");
    expect(html).not.toContain("Pay ");
  });

  it("does not link the library after a download-only x402 payment", () => {
    const html = renderToStaticMarkup(
      <PurchaseSuccessPanel
        completed={{ method: "x402", licenseType: "personal", result: x402Result("download_only") }}
        x402DownloadUrl="blob:stem"
        onDone={() => {}}
      />,
    );
    expect(html).toContain("Download stem");
    expect(html).not.toContain("View in your library");
    expect(html).toContain(">Done<");
  });
});
