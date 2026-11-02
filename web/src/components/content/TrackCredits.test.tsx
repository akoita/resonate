import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrackCredits } from "./TrackCredits";

describe("TrackCredits", () => {
  it("links the artist and album when their pages are known", () => {
    const html = renderToStaticMarkup(
      <TrackCredits
        artist="Leona Lewis"
        album="Glassheart (Deluxe Edition)"
        artistHref="/artist/credit-1"
        albumHref="/release/rel-1"
      />,
    );
    expect(html).toContain('href="/artist/credit-1"');
    expect(html).toContain('href="/release/rel-1"');
    expect(html).toContain(" • ");
  });

  it("keeps names without a page as plain text", () => {
    const html = renderToStaticMarkup(<TrackCredits artist="Someone" album="Home Tapes" />);
    expect(html).not.toContain("href=");
    expect(html).toContain("Someone");
    expect(html).toContain("Home Tapes");
  });

  it("never links the fallback label and drops the separator without an album", () => {
    const html = renderToStaticMarkup(
      <TrackCredits artist={null} artistFallback="Unknown Artist" artistHref="/artist/x" as="div" />,
    );
    expect(html).toBe("<div><span>Unknown Artist</span></div>");
  });
});
