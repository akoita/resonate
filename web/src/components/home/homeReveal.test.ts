/**
 * Home reveal order (#2254) — real content never paints below a slot that is
 * still loading above it.
 */
import { describe, expect, it } from "vitest";
import type { HomeFeedResponse } from "../../lib/api";
import {
  FEED_ERROR,
  FEED_LOADING,
  homeRevealState,
  type FeedState,
  type HomeRevealInput,
} from "./homeReveal";
import { RAIL_ERROR, RAIL_LOADING, type RailState } from "./railState";

const READY_RAILS: RailState<unknown> = { status: "ready", items: [{}] };
const READY_EMPTY: RailState<unknown> = { status: "ready", items: [] };

function readyFeed(rails: HomeFeedResponse["rails"] = []): FeedState {
  return { status: "ready", feed: { userId: "u", requestId: "r", cold: false, rails } };
}

function reveal(overrides: Partial<HomeRevealInput>) {
  return homeRevealState({
    sessionChecked: true,
    signedIn: true,
    feed: FEED_LOADING,
    trending: RAIL_LOADING,
    topArtists: RAIL_LOADING,
    ...overrides,
  });
}

describe("homeRevealState", () => {
  it("holds everything on skeletons, and reserves no feed slot, before the session is checked", () => {
    expect(
      reveal({ sessionChecked: false, signedIn: false, trending: READY_RAILS, topArtists: READY_RAILS }),
    ).toEqual({ feedSlot: "hidden", trending: "skeleton", topArtists: "skeleton" });
  });

  it("popularity resolves before the feed: reserves a feed skeleton and keeps the rails on skeletons", () => {
    expect(
      reveal({ feed: FEED_LOADING, trending: READY_RAILS, topArtists: READY_RAILS }),
    ).toEqual({ feedSlot: "skeleton", trending: "skeleton", topArtists: "skeleton" });
  });

  it("the feed resolves first: shows the feed but still holds the rails until popularity arrives", () => {
    expect(
      reveal({ feed: readyFeed([{ id: "a", kind: "because_genre", title: "t", explanation: "e", items: [] }]) }),
    ).toEqual({ feedSlot: "content", trending: "skeleton", topArtists: "skeleton" });
  });

  it("reveals the feed and the rails together once both have arrived", () => {
    expect(
      reveal({ feed: readyFeed(), trending: READY_RAILS, topArtists: READY_EMPTY }),
    ).toEqual({ feedSlot: "content", trending: "content", topArtists: "content" });
  });

  it("reveals each popularity rail independently once the feed is settled", () => {
    expect(
      reveal({ feed: readyFeed(), trending: READY_RAILS, topArtists: RAIL_LOADING }),
    ).toEqual({ feedSlot: "content", trending: "content", topArtists: "skeleton" });
  });

  it("a failed feed shows no feed slot and does not hold the rails forever", () => {
    expect(
      reveal({ feed: FEED_ERROR, trending: READY_RAILS, topArtists: RAIL_ERROR }),
    ).toEqual({ feedSlot: "hidden", trending: "content", topArtists: "content" });
  });

  it("a failed feed still waits for popularity before revealing the rails", () => {
    expect(reveal({ feed: FEED_ERROR })).toEqual({
      feedSlot: "hidden",
      trending: "skeleton",
      topArtists: "skeleton",
    });
  });

  it("signed out: never shows a feed skeleton and reveals the rails as soon as popularity arrives", () => {
    expect(reveal({ signedIn: false, trending: RAIL_LOADING, topArtists: RAIL_LOADING })).toEqual({
      feedSlot: "hidden",
      trending: "skeleton",
      topArtists: "skeleton",
    });
    expect(reveal({ signedIn: false, trending: READY_RAILS, topArtists: READY_RAILS })).toEqual({
      feedSlot: "hidden",
      trending: "content",
      topArtists: "content",
    });
  });

  it("cold start (no rails) still renders the feed slot so 'warming up' shows", () => {
    expect(
      reveal({ feed: readyFeed([]), trending: READY_EMPTY, topArtists: READY_EMPTY }).feedSlot,
    ).toBe("content");
  });

  it("ignores a stale feed state for a signed-out visitor", () => {
    expect(
      reveal({ signedIn: false, feed: readyFeed(), trending: READY_RAILS, topArtists: READY_RAILS }).feedSlot,
    ).toBe("hidden");
  });
});
