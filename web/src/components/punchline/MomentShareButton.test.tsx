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

import { MomentShareButton } from "./MomentShareButton";

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
});
