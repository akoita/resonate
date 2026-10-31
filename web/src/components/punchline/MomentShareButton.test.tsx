import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The button pulls in the toast context + browser analytics; stub both so the
// render is deterministic in the node vitest environment. Click-time
// share/clipboard/analytics behavior is unit-tested against the pure
// `performMomentShare` / `buildMomentShareUrl` helpers in momentShare.test.ts.
vi.mock("../ui/Toast", () => ({
  useToast: () => ({ addToast: () => {} }),
}));
vi.mock("../../lib/productAnalytics", () => ({
  recordProductAnalyticsFromBrowser: () => {},
}));

import { MomentShareButton, momentShareLink } from "./MomentShareButton";

describe("MomentShareButton", () => {
  it("renders a Share button (inventory context)", () => {
    const html = renderToStaticMarkup(
      <MomentShareButton
        momentId="m1"
        dropId="d1"
        collectibleId="c1"
        context="inventory"
        shareTitle="A moment I collected on Resonate"
        shareText="the hook"
      />,
    );
    expect(html).toContain("Share");
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  it("honors a custom label", () => {
    const html = renderToStaticMarkup(
      <MomentShareButton
        momentId="m1"
        dropId="d1"
        context="collect_module"
        shareTitle="t"
        shareText="x"
        label="Share moment"
      />,
    );
    expect(html).toContain("Share moment");
  });

  it("offers an attributable X post when xText is given", () => {
    const html = renderToStaticMarkup(
      <MomentShareButton
        momentId="m1"
        dropId="d1"
        collectibleId="c1"
        context="collect_module"
        trigger="after_collect"
        shareTitle="t"
        shareText="x"
        xText="I collected edition №7 of 50 on Resonate."
      />,
    );
    const href = html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const intent = new URL(href);
    expect(intent.origin).toBe("https://x.com");
    expect(intent.searchParams.get("text")).toBe("I collected edition №7 of 50 on Resonate.");
    const shared = new URL(intent.searchParams.get("url") ?? "");
    expect(shared.pathname).toBe("/moments/m1");
    expect(shared.searchParams.get("c")).toBe("c1");
    expect(shared.searchParams.get("utm_source")).toBe("x");
    expect(shared.searchParams.get("utm_campaign")).toBe("collectible_share");
  });

  it("omits the X link without xText", () => {
    const html = renderToStaticMarkup(
      <MomentShareButton momentId="m1" dropId="d1" context="inventory" shareTitle="t" shareText="x" />,
    );
    expect(html).not.toContain("x.com/intent");
  });
});

describe("momentShareLink", () => {
  it("links the moment permalink, or the drop's release page without a moment", () => {
    expect(new URL(momentShareLink({ momentId: "m1" }, "copy") ?? "").pathname).toBe("/moments/m1");
    const drop = new URL(momentShareLink({ releaseId: "r1" }, "native") ?? "");
    expect(drop.pathname).toBe("/release/r1");
    expect(drop.searchParams.get("focus")).toBe("moments");
    expect(drop.searchParams.get("utm_campaign")).toBe("collectible_share");
    expect(momentShareLink({}, "copy")).toBeNull();
  });
});
