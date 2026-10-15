import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListStemModal } from "./ListStemModal";

vi.mock("../../hooks/useContracts", () => ({
  useListStemTiers: () => ({
    listTiers: vi.fn(),
    pending: false,
    error: null,
    txHash: null,
  }),
  useStemBalance: () => ({ balance: 1n }),
  useStemData: () => ({ data: { royaltyBps: 500n, creator: "0x" + "b".repeat(40) } }),
  useProtocolFee: () => ({ feeBps: 1000n, loading: false }),
}));
vi.mock("../../hooks/usePaymentAssets", () => ({
  usePaymentAssets: () => ({
    assets: [
      {
        assetId: "usdc",
        symbol: "USDC",
        name: "Circle USDC",
        decimals: 6,
        chainId: 31337,
        kind: "stablecoin",
        enabled: true,
        settlement: ["marketplace"],
        tokenAddress: "0x" + "1".repeat(40),
      },
    ],
    defaultAsset: "usdc",
    loading: false,
  }),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    token: "jwt",
    address: "0x" + "a".repeat(40),
    smartAccountAddress: "0x" + "b".repeat(40),
  }),
}));
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock("../auth/ZeroDevProviderClient", () => ({
  useZeroDev: () => ({ chainId: 31337 }),
}));

describe("ListStemModal", () => {
  it("renders the multi-tier picker with personal selected and a one-confirmation summary", () => {
    const html = renderToStaticMarkup(
      <ListStemModal
        tokenId={74n}
        isOpen
        onClose={() => {}}
      />,
    );
    expect(html).toContain("License tiers");
    expect(html).toContain("Personal (NFT)");
    expect(html).toContain("Remix License");
    expect(html).toContain("Commercial License");
    expect(html).toContain("Use in derivative works, publish remixes");
    expect(html).toContain("A remix license is what unlocks Remix Studio for this stem.");
    // Personal is selected by default with a price and edition input.
    expect(html).toContain("tier-picker__row--selected");
    expect(html).toContain('id="list-74-personal-price"');
    expect(html).toContain('id="list-74-personal-amount"');
    expect(html).not.toContain('id="list-74-remix-price"');
    // Balance 1 covers one personal edition: nothing to mint.
    expect(html).toContain("Lists 1 license tier (1 edition) in one confirmation.");
    expect(html).toContain("List for Sale");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <ListStemModal tokenId={74n} isOpen={false} onClose={() => {}} />,
    );
    expect(html).toBe("");
  });
});
