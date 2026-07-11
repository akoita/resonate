/**
 * Home feed v2 rails (#1454 WS-7) — multi-rail render, explanation strings,
 * exploration presence, cold vs warm labeling, and the honest empty state.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeFeedRails } from "./HomeFeedRails";
import type { HomeFeedItem, HomeFeedRail, HomeFeedResponse } from "../../lib/api";

function item(overrides: Partial<HomeFeedItem> = {}): HomeFeedItem {
  return {
    id: "trk_1",
    title: "Groove 1",
    artist: "Taste Artist",
    artistId: "art_1",
    releaseId: "rel_1",
    releaseTitle: "Amapiano Sessions",
    genre: "Amapiano",
    moods: [],
    artworkMimeType: null,
    reasons: ["genre:Amapiano"],
    ...overrides,
  };
}

function rail(overrides: Partial<HomeFeedRail> = {}): HomeFeedRail {
  return {
    id: "because_genre",
    kind: "because_genre",
    title: "Because you save a lot of Amapiano",
    explanation: "Ranked for your Amapiano taste — from your saved preferences.",
    items: [item()],
    ...overrides,
  };
}

function feed(rails: HomeFeedRail[], cold = false): HomeFeedResponse {
  return { userId: "user-1", requestId: "req-1", cold, rails };
}

describe("HomeFeedRails", () => {
  it("renders nothing while loading (feed === null)", () => {
    expect(renderToStaticMarkup(<HomeFeedRails feed={null} />)).toBe("");
  });

  it("renders multiple rails, each with its title and categorical explanation", () => {
    const html = renderToStaticMarkup(
      <HomeFeedRails
        feed={feed([
          rail(),
          rail({
            id: "new_from_artists",
            kind: "new_from_artists",
            title: "New from artists you play",
            explanation: "The latest uploads from artists you already listen to.",
            items: [item({ id: "trk_2", title: "Played Cut", reasons: ["artist:followed-by-plays"] })],
          }),
        ])}
      />,
    );
    expect(html).toContain("Because you save a lot of Amapiano");
    expect(html).toContain("Ranked for your Amapiano taste");
    expect(html).toContain("New from artists you play");
    expect(html).toContain("The latest uploads from artists you already listen to.");
    // Two distinct rail sections, not one flat list.
    expect(html.match(/data-rail-kind=/g)).toHaveLength(2);
    expect(html).toContain('href="/release/rel_1"');
  });

  it("marks the exploration rail and its fresh-find items", () => {
    const html = renderToStaticMarkup(
      <HomeFeedRails
        feed={feed([
          rail({
            id: "exploration",
            kind: "exploration",
            title: "Step outside your lanes",
            explanation: "Fresh, under-the-radar drops with almost no plays yet.",
            items: [item({ id: "trk_9", title: "Fresh Cut", reasons: ["exploration:fresh"] })],
          }),
        ])}
      />,
    );
    expect(html).toContain('data-rail-kind="exploration"');
    expect(html).toContain("Step outside your lanes");
    expect(html).toContain("Fresh find");
  });

  it("cold users see the explicit Catalog signal label, not fake personalization", () => {
    const html = renderToStaticMarkup(
      <HomeFeedRails
        feed={feed(
          [
            rail({
              id: "catalog_signal",
              kind: "catalog_signal",
              title: "Catalog signal",
              explanation: "We don't know your taste yet.",
              items: [item({ reasons: ["catalog:trending"] })],
            }),
          ],
          true,
        )}
      />,
    );
    expect(html).toContain("Catalog signal");
    expect(html).not.toContain("Because you save");
  });

  it("shows the honest empty state when there are no rails (no catalog fallback)", () => {
    const html = renderToStaticMarkup(<HomeFeedRails feed={feed([])} />);
    expect(html).toContain("Your feed is warming up");
    expect(html).toContain("Nothing to rank honestly yet");
    expect(html).not.toContain("ng-recommendation-card");
  });

  it("renders a working session action per item when a handler is provided", () => {
    const html = renderToStaticMarkup(
      <HomeFeedRails feed={feed([rail()])} onStartSession={() => undefined} />,
    );
    expect(html).toContain("Start session");
    const withoutHandler = renderToStaticMarkup(<HomeFeedRails feed={feed([rail()])} />);
    expect(withoutHandler).not.toContain("Start session"); // no dead buttons
  });
});
