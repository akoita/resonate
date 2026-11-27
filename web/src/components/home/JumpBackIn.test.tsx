/**
 * "Jump back in" card (#2735): a link and a sibling play button (never nested),
 * the type badge, when it happened, and Resume wording for a played item.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JumpBackInCard } from "./JumpBackIn";
import type { JumpBackInItem } from "../../lib/jumpBackIn";

const NOW = Date.UTC(2026, 10, 27, 12);

const item = (overrides: Partial<JumpBackInItem> = {}): JumpBackInItem => ({
  key: "release:r1",
  kind: "release",
  title: "Taama",
  subtitle: "Mawa Traoré",
  badge: "Album",
  icon: "album",
  href: "/release/r1",
  covers: ["https://cdn.example/cover.jpg"],
  at: NOW - 2 * 3_600_000,
  last: "played",
  play: { kind: "release", releaseId: "r1", resumeTrackId: "t3" },
  ...overrides,
});

describe("JumpBackInCard", () => {
  it("offers Resume for something played, beside the link", () => {
    const html = renderToStaticMarkup(<JumpBackInCard item={item()} now={NOW} busy={false} onPlay={() => {}} />);
    expect(html).toContain('href="/release/r1"');
    expect(html).toContain('aria-label="Resume Taama"');
    expect(html).toContain("Played 2 h ago");
    expect(html).toContain("Album");
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>).)*<button/s);
  });

  it("offers Play for an opened page and no button when nothing plays", () => {
    const opened = renderToStaticMarkup(
      <JumpBackInCard item={item({ last: "opened", play: { kind: "release", releaseId: "r1" } })} now={NOW} busy={false} onPlay={() => {}} />,
    );
    expect(opened).toContain('aria-label="Play Taama"');
    expect(opened).toContain("Opened 2 h ago");

    const show = renderToStaticMarkup(
      <JumpBackInCard item={item({ kind: "show", badge: "Show", play: undefined })} now={NOW} busy={false} onPlay={() => {}} />,
    );
    expect(show).not.toContain("<button");
  });

  it("draws an artist round and a missing cover as an icon", () => {
    const html = renderToStaticMarkup(
      <JumpBackInCard item={item({ kind: "artist", badge: "Artist", icon: "mic", covers: [] })} now={NOW} busy={false} />,
    );
    expect(html).toContain("ng-jump-card__art--round");
    expect(html).toContain("ng-jump-card__monogram");
  });
});
