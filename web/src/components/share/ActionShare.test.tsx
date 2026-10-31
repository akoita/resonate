import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Copy, links, and analytics payloads are unit-tested in lib/fanActionShare.test.ts.
vi.mock("../../lib/productAnalytics", () => ({
  recordProductAnalyticsFromBrowser: () => {},
}));

import { ActionShare } from "./ActionShare";
import { RemixPublishShare } from "../remix/RemixPublishShare";

describe("ActionShare", () => {
  it("renders every share channel and stays inert until mounted", () => {
    const html = renderToStaticMarkup(
      <ActionShare
        kind="license"
        label="Share what you licensed"
        shareUrl={(origin) => `${origin}/stem/1`}
        message={() => ({ title: "t", text: "x" })}
      />,
    );
    for (const name of ["Share", "Share on X", "Share on Facebook", "Share on Reddit", "Copy link"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).toContain('data-share="license"');
    expect(html).toMatch(/inert=""/);
    expect(html).not.toContain("x.com/intent");
  });

  it("offers the remix share with its own label", () => {
    const html = renderToStaticMarkup(
      <RemixPublishShare releaseId="rel_1" projectId="prj_1" remixTitle="Dawn" sourceTrackTitle="Night Drive" />,
    );
    expect(html).toContain('data-share="remix"');
    expect(html).toContain("Share your remix");
  });
});
