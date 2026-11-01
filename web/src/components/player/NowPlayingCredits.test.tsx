import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NowPlayingCredits, nowPlayingArtistHref, nowPlayingReleaseHref } from "./NowPlayingCredits";

describe("NowPlayingCredits", () => {
  it("links the album to its release page and the artist to their page", () => {
    const html = renderToStaticMarkup(
      <NowPlayingCredits artist="Keri Hilson" album="In A Perfect World" releaseId="rel_1" artistId="art_1" />,
    );
    expect(html).toContain('href="/release/rel_1"');
    expect(html).toContain('href="/artist/art_1"');
    expect(html).toContain("In A Perfect World");
    expect(html).toContain("Keri Hilson");
    expect(html).toContain(" • ");
  });

  it("keeps local-library tracks as plain text", () => {
    const html = renderToStaticMarkup(<NowPlayingCredits artist="Someone" album="Home Tapes" />);
    expect(html).not.toContain("href=");
    expect(html).toContain("Someone");
    expect(html).toContain("Home Tapes");
  });

  it("drops the separator when the album is missing", () => {
    const html = renderToStaticMarkup(<NowPlayingCredits artist="Solo" releaseId="rel_2" />);
    expect(html).not.toContain("•");
    expect(html).not.toContain("/release/");
  });

  it("encodes ids and ignores blank ones", () => {
    expect(nowPlayingReleaseHref("a/b")).toBe("/release/a%2Fb");
    expect(nowPlayingReleaseHref("  ")).toBeNull();
    expect(nowPlayingArtistHref(null)).toBeNull();
  });
});
