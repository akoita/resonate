import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PurchaseHandoff, purchaseHandoffActions } from "./PurchaseHandoff";

const mockUseAuth = vi.fn(() => ({ token: "jwt-token" as string | null }));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("purchaseHandoffActions (#2042)", () => {
  it("offers the library and Remix Studio after a remix purchase", () => {
    expect(purchaseHandoffActions({ licenseType: "remix", trackId: "t1", inLibrary: true })).toEqual({
      library: true,
      remixStudio: true,
    });
    expect(purchaseHandoffActions({ licenseType: "commercial", trackId: "t1", inLibrary: true }).remixStudio).toBe(true);
  });

  it("offers only the library after a personal purchase", () => {
    expect(purchaseHandoffActions({ licenseType: "personal", trackId: "t1", inLibrary: true })).toEqual({
      library: true,
      remixStudio: false,
    });
  });

  it("needs a source track to offer Remix Studio", () => {
    expect(purchaseHandoffActions({ licenseType: "remix", trackId: undefined, inLibrary: true }).remixStudio).toBe(false);
  });

  it("hides the library link when the purchase does not land there", () => {
    expect(purchaseHandoffActions({ licenseType: "personal", inLibrary: false })).toEqual({
      library: false,
      remixStudio: false,
    });
  });
});

describe("PurchaseHandoff rendering (#2042)", () => {
  it("links to Library › Stems and Remix Studio for a remix license", () => {
    const html = renderToStaticMarkup(
      <PurchaseHandoff licenseType="remix" trackId="t1" stemId="s1" inLibrary />,
    );
    expect(html).toContain('href="/library?tab=stems"');
    expect(html).toContain("View in your library");
    expect(html).toContain("Open in Remix Studio");
  });

  it("shows only the library link for a personal license", () => {
    const html = renderToStaticMarkup(
      <PurchaseHandoff licenseType="personal" trackId="t1" stemId="s1" inLibrary />,
    );
    expect(html).toContain("View in your library");
    expect(html).not.toContain("Open in Remix Studio");
  });

  it("renders nothing when the purchase is not in the library and cannot be remixed", () => {
    const html = renderToStaticMarkup(
      <PurchaseHandoff licenseType="personal" inLibrary={false} />,
    );
    expect(html).toBe("");
  });

  it("does not offer Remix Studio without a session", () => {
    mockUseAuth.mockReturnValueOnce({ token: null });
    const html = renderToStaticMarkup(
      <PurchaseHandoff licenseType="remix" trackId="t1" stemId="s1" inLibrary />,
    );
    expect(html).toContain("View in your library");
    expect(html).not.toContain("Open in Remix Studio");
  });
});
