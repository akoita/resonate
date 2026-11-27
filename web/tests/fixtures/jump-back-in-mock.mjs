/**
 * Invented "Jump back in" data (#2735) for screenshots and visual checks:
 * the server's recent plays (/listening/recent) and this device's opened
 * pages (localStorage). Every name here is made up and every cover is the
 * generated abstract art of guide-seed-mock.mjs, served from the API base.
 * Times are relative to `now`.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const art = (apiBase, hue, seed) => `${apiBase}/guide-art/cover-${hue}-${seed}.svg`;
const cover = (apiBase, hue, seed) => ({
  releaseId: `jbi-${seed}`,
  artworkUrl: art(apiBase, hue, seed),
  hasUploadedArtwork: false,
  artworkRevision: 1,
});

export function jumpBackInRecentMock(apiBase = "http://localhost:3000", now = Date.now()) {
  const at = (ms) => new Date(now - ms).toISOString();
  return {
    schemaVersion: "listening-recent/v1",
    recording: true,
    items: [
      {
        kind: "release",
        ...cover(apiBase, 262, "golden-hour"),
        title: "Golden Hour",
        releaseType: "album",
        isRemix: false,
        artistId: "jbi-nova-line",
        artistName: "Nova Line",
        aiDisclosure: null,
        lastTrackId: "jbi-golden-hour-3",
        lastTrackTitle: "Night Signals",
        lastPlayedAt: at(12 * MIN),
      },
      {
        kind: "playlist",
        playlistId: "jbi-late-night",
        name: "Late night drive",
        isOwner: true,
        visibility: "private",
        trackCount: 24,
        covers: [cover(apiBase, 12, "low-tide"), cover(apiBase, 200, "blue-hour"), cover(apiBase, 300, "slow-bloom"), cover(apiBase, 160, "quiet-static")],
        lastTrackId: "jbi-low-tide-1",
        lastTrackTitle: "Low Tide",
        lastPlayedAt: at(2 * HOUR),
      },
      {
        kind: "release",
        ...cover(apiBase, 32, "low-tide-remix"),
        title: "Low Tide (Sabi Drift remix)",
        releaseType: "remix",
        isRemix: true,
        artistId: "jbi-sabi-drift",
        artistName: "Sabi Drift",
        aiDisclosure: { level: "partly", containsAI: "partly", facets: ["instruments"], source: "remix_derived", label: "AI-assisted" },
        lastTrackId: "jbi-low-tide-remix-1",
        lastTrackTitle: "Low Tide (Sabi Drift remix)",
        lastPlayedAt: at(3 * DAY),
      },
      {
        kind: "release",
        ...cover(apiBase, 340, "signal-fire"),
        title: "Signal Fire",
        releaseType: "single",
        isRemix: false,
        artistId: "jbi-okonkwo",
        artistName: "Okonkwo",
        aiDisclosure: null,
        lastTrackId: "jbi-signal-fire-1",
        lastTrackTitle: "Signal Fire",
        lastPlayedAt: at(15 * DAY),
      },
      {
        kind: "playlist",
        playlistId: "jbi-sunday-slow",
        name: "Sunday slow",
        isOwner: false,
        visibility: "public",
        trackCount: 18,
        covers: [cover(apiBase, 120, "sunday-slow")],
        lastTrackId: "jbi-sunday-1",
        lastTrackTitle: "Paper Moons",
        lastPlayedAt: at(62 * DAY),
      },
      {
        kind: "release",
        ...cover(apiBase, 220, "paper-moons"),
        title: "Paper Moons",
        releaseType: "ep",
        isRemix: false,
        artistId: "jbi-kora-waves",
        artistName: "Kora Waves",
        aiDisclosure: null,
        lastTrackId: "jbi-paper-moons-2",
        lastTrackTitle: "Paper Moons",
        lastPlayedAt: at(120 * DAY),
      },
    ],
  };
}

/** Opened pages, as `recordRecentView` stores them (newest first). */
export function jumpBackInViewsMock(apiBase = "http://localhost:3000", now = Date.now()) {
  return [
    { kind: "artist", id: "jbi-kora-waves", title: "Kora Waves", subtitle: "Afro-soul", imageUrl: art(apiBase, 190, "kora-waves"), href: "/artist/jbi-kora-waves", artistId: "jbi-kora-waves", viewedAt: now - 5 * HOUR },
    { kind: "remixDraft", id: "jbi-draft-low-tide", title: "Low Tide flip", subtitle: "Remix of Low Tide", href: "/remix/studio/jbi-draft-low-tide", viewedAt: now - 9 * HOUR },
    { kind: "show", id: "jbi-mara-sol-lisbon", title: "Mara Sol in Lisbon", subtitle: "Mara Sol · Lisbon", imageUrl: art(apiBase, 24, "mara-sol"), href: "/shows/jbi-mara-sol-lisbon", viewedAt: now - 26 * HOUR },
    { kind: "mixer", id: "jbi-glass-harbour", title: "Glass Harbour", subtitle: "The Night Orchard", imageUrl: art(apiBase, 280, "glass-harbour"), href: "/release/jbi-glass-harbour?mixer=true", viewedAt: now - 4 * DAY },
    { kind: "stem", id: "4127", title: "Blue Hour — Vocals", subtitle: "vocals · Mara Sol", imageUrl: art(apiBase, 200, "blue-hour"), href: "/stem/4127", viewedAt: now - 21 * DAY },
  ];
}
