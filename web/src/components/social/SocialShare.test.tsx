import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SocialShare from "./SocialShare";

describe("SocialShare", () => {
  const unresolved = { title: "Breathe", artist: "Fabolous", catalogTrackId: "trk_1" };

  it("keeps the share row in place, inert, while the release link is still resolving", () => {
    const html = renderToStaticMarkup(<SocialShare track={unresolved} pending />);
    expect(html).toContain("share-action-row");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).not.toContain("Sharing is available");
  });

  it("explains, at the same height, when a track genuinely cannot be shared", () => {
    const html = renderToStaticMarkup(<SocialShare track={{ title: "Local file" }} />);
    expect(html).toContain("Sharing is available for tracks with a public Resonate release.");
    expect(html).toContain("min-height:36px");
  });
});
