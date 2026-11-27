import { describe, expect, it } from "vitest";
import type { RecentPlayItem } from "./api";
import { formatRecentAge, mergeJumpBackIn } from "./jumpBackIn";
import type { RecentView } from "./recentViews";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 27, 12);
const iso = (ms: number) => new Date(NOW - ms).toISOString();

const releasePlay = (id: string, agoMs: number, extra: Partial<RecentPlayItem> = {}): RecentPlayItem => ({
  kind: "release",
  releaseId: id,
  title: `Release ${id}`,
  releaseType: "album",
  isRemix: false,
  artistId: "artist",
  artistName: "Artist",
  aiDisclosure: null,
  artworkUrl: null,
  hasUploadedArtwork: true,
  artworkRevision: 2,
  lastTrackId: `${id}-t3`,
  lastTrackTitle: "Song",
  lastPlayedAt: iso(agoMs),
  ...(extra as object),
} as RecentPlayItem);

const view = (kind: RecentView["kind"], id: string, agoMs: number): RecentView => ({
  kind,
  id,
  title: `${kind} ${id}`,
  href: `/${kind}/${id}`,
  viewedAt: NOW - agoMs,
});

describe("mergeJumpBackIn", () => {
  it("mixes plays and opened pages newest first with type badges", () => {
    const items = mergeJumpBackIn(
      [releasePlay("r1", 3 * HOUR), releasePlay("r2", 30 * 24 * HOUR, { isRemix: true } as Partial<RecentPlayItem>)],
      [view("artist", "a1", HOUR), view("show", "s1", 5 * 24 * HOUR)],
    );
    expect(items.map((item) => `${item.key} ${item.badge}`)).toEqual([
      "artist:a1 Artist",
      "release:r1 Album",
      "show:s1 Show",
      "release:r2 Remix",
    ]);
    expect(items[1].covers[0]).toContain("/catalog/releases/r1/artwork/v2");
    expect(items[1].play).toEqual({ kind: "release", releaseId: "r1", resumeTrackId: "r1-t3" });
    expect(items[2].play).toBeUndefined();
  });

  it("shows a release played and later opened once, keeping the resume point", () => {
    const [item, ...rest] = mergeJumpBackIn([releasePlay("r1", 3 * HOUR)], [view("release", "r1", HOUR)]);
    expect(rest).toHaveLength(0);
    expect(item.last).toBe("opened");
    expect(item.at).toBe(NOW - HOUR);
    expect(item.play).toMatchObject({ resumeTrackId: "r1-t3" });
  });

  it("keeps the release and its mixer apart", () => {
    const items = mergeJumpBackIn([], [view("release", "r1", HOUR), view("mixer", "r1", 2 * HOUR)]);
    expect(items.map((item) => item.badge)).toEqual(["Release", "Stems"]);
  });

  it("hides everything up to a clear and stops at the limit", () => {
    const items = mergeJumpBackIn(
      [releasePlay("old", 5 * HOUR)],
      [view("artist", "a1", HOUR), view("artist", "a2", 2 * HOUR), view("artist", "a3", 3 * HOUR)],
      { clearedAt: NOW - 4 * HOUR, limit: 2 },
    );
    expect(items.map((item) => item.key)).toEqual(["artist:a1", "artist:a2"]);
  });

  it("opens your own playlist in the library and another listener's on its public page", () => {
    const playlist = (isOwner: boolean): RecentPlayItem => ({
      kind: "playlist",
      playlistId: isOwner ? "mine" : "theirs",
      name: "Mix",
      isOwner,
      visibility: isOwner ? "private" : "public",
      trackCount: 3,
      covers: [],
      lastTrackId: "t",
      lastTrackTitle: "Song",
      lastPlayedAt: iso(HOUR),
    });
    const [mine] = mergeJumpBackIn([playlist(true)], []);
    const [theirs] = mergeJumpBackIn([playlist(false)], []);
    expect(mine.href).toBe("/library?tab=playlists&playlist=mine");
    expect(theirs.href).toBe("/playlist/theirs");
  });
});

describe("formatRecentAge", () => {
  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5 min ago"],
    [3 * HOUR, "3 h ago"],
    [30 * HOUR, "yesterday"],
    [4 * 24 * HOUR, "4 days ago"],
    [21 * 24 * HOUR, "3 weeks ago"],
    [90 * 24 * HOUR, "3 months ago"],
  ])("%d ms → %s", (ago, label) => {
    expect(formatRecentAge(NOW - ago, NOW)).toBe(label);
  });
});
