import type { HomeFeedResponse } from "../../lib/api";
import type { RailState } from "./railState";

/*
 * Home reveal order (#2254). Sections are laid out feed -> Trending Now ->
 * Top Artists, but their data arrives in a different order (popularity needs
 * no auth, the feed needs the restored session first). Real content must never
 * paint below a slot that is still loading above it, so Home reveals in layout
 * order: this pure function decides, from the load states alone, which slots
 * show a skeleton and which show content.
 */

/** Load state of the personalized feed (only meaningful for a signed-in listener). */
export type FeedState =
  | { status: "loading" }
  | { status: "ready"; feed: HomeFeedResponse }
  | { status: "error" };

export const FEED_LOADING: { status: "loading" } = { status: "loading" };
export const FEED_ERROR: { status: "error" } = { status: "error" };

export type HomeRevealInput = {
  /** Auth has finished restoring (or not finding) the stored session. */
  sessionChecked: boolean;
  /** A session is restored and the feed request can be made. */
  signedIn: boolean;
  feed: FeedState;
  trending: RailState<unknown>;
  topArtists: RailState<unknown>;
};

export type HomeRevealState = {
  /**
   * - `hidden`: render nothing (session not checked, signed out, or the feed failed)
   * - `skeleton`: a signed-in feed is loading; reserve one shelf
   * - `content`: render the feed (including its cold-start "warming up" shelf)
   */
  feedSlot: "hidden" | "skeleton" | "content";
  /** `skeleton` until the feed is settled and the popularity data has arrived. */
  trending: "skeleton" | "content";
  topArtists: "skeleton" | "content";
};

export function homeRevealState(input: HomeRevealInput): HomeRevealState {
  const { sessionChecked, signedIn, feed, trending, topArtists } = input;
  const feedExpected = sessionChecked && signedIn;

  const feedSlot: HomeRevealState["feedSlot"] = !feedExpected
    ? "hidden"
    : feed.status === "loading"
      ? "skeleton"
      : feed.status === "ready"
        ? "content"
        : "hidden";

  // A failed feed counts as settled so an error never holds the page forever;
  // a signed-out visitor has no feed to wait for once the session is checked.
  const feedSettled = sessionChecked && (!signedIn || feed.status !== "loading");

  return {
    feedSlot,
    trending: feedSettled && trending.status !== "loading" ? "content" : "skeleton",
    topArtists: feedSettled && topArtists.status !== "loading" ? "content" : "skeleton",
  };
}
