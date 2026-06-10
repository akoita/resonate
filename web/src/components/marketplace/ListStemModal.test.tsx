import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListStemModal } from "./ListStemModal";

vi.mock("../../hooks/useContracts", () => ({
  useListStem: () => ({
    list: vi.fn(),
    pending: false,
    error: null,
    txHash: null,
  }),
  useStemBalance: () => ({ balance: 1n }),
}));
vi.mock("../../hooks/usePaymentAssets", () => ({
  usePaymentAssets: () => ({
    assets: [
      {
        assetId: "usdc",
        symbol: "USDC",
        name: "Circle USDC",
        decimals: 6,
        address: "0x" + "1".repeat(40),
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
  it("renders the license tier picker with remix described as the Remix Studio unlock", () => {
    const html = renderToStaticMarkup(
      <ListStemModal
        tokenId={74n}
        stemId="stem-1"
        isOpen
        onClose={() => {}}
      />,
    );
    expect(html).toContain("License Type");
    expect(html).toContain("Personal (NFT)");
    expect(html).toContain("Remix License");
    expect(html).toContain("Commercial License");
    expect(html).toContain("Use in derivative works, publish remixes");
    expect(html).toContain(
      "A remix\n              license is what unlocks Remix Studio for this stem.".replace(/\n\s+/g, " "),
    );
    // Personal is the default selection; summary reflects it.
    expect(html).toContain("license-option--selected");
    expect(html).toContain("personal");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <ListStemModal tokenId={74n} isOpen={false} onClose={() => {}} />,
    );
    expect(html).toBe("");
  });
});
