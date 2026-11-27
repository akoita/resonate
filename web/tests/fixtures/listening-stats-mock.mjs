/**
 * Invented "Your listening" data (/listening/stats) for the User Guide
 * screenshot and the Playwright flow. Every artist, track and number here is
 * made up. Plays are placed relative to `now` so the chart always ends today.
 */

const SLOT_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

const ARTISTS = [
  ["Nova Line", 41, 168],
  ["Kora Waves", 27, 104],
  ["The Night Orchard", 19, 77],
  ["Mara Sol", 14, 52],
  ["Okonkwo", 11, 44],
  ["Lumen Avenue", 8, 29],
  ["Sabi Drift", 6, 22],
  ["Paper Lanterns", 4, 15],
];

const TRACKS = [
  ["Golden Hour", "Nova Line", 14, 52],
  ["Low Tide", "Kora Waves", 11, 41],
  ["Night Signals", "Nova Line", 9, 33],
  ["Glass Harbour", "The Night Orchard", 8, 31],
  ["Blue Hour", "Mara Sol", 7, 25],
  ["After the Rain", "Nova Line", 7, 24],
  ["Signal Fire", "Okonkwo", 6, 23],
  ["Paper Moons", "Kora Waves", 5, 19],
  ["Slow Bloom", "Lumen Avenue", 5, 17],
  ["Quiet Static", "Sabi Drift", 4, 15],
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Daily plays for the last `days` days, oldest first, with a few rest days. */
function dailyPlays(days) {
  const pattern = [6, 4, 0, 7, 9, 5, 3, 8, 11, 6, 0, 4, 7, 10, 12, 6, 5, 0, 8, 9, 7, 4, 6, 13, 9, 5, 7, 8, 10, 6];
  return Array.from({ length: days }, (_, index) => pattern[(index + 3) % pattern.length]);
}

export function listeningStatsMock(days = 30, now = new Date()) {
  const counts = dailyPlays(days);
  const activity = [];
  let plays = 0;
  let seconds = 0;
  counts.forEach((count, index) => {
    if (count === 0) return;
    const day = new Date(now.getTime() - (days - 1 - index) * DAY_MS);
    // Mostly evenings, some mornings, the odd late night.
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), index % 5 === 0 ? 8 : 20, 30);
    if (at.getTime() > now.getTime()) at.setTime(now.getTime() - 60 * 60_000);
    const slot = Math.floor(at.getTime() / SLOT_MS);
    const listened = count * 215;
    activity.push([slot, count, listened]);
    plays += count;
    seconds += listened;
  });
  const scale = plays / 130;
  return {
    schemaVersion: "listening-stats/v1",
    windowDays: days,
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
    recording: true,
    truncated: false,
    summary: {
      plays,
      minutes: Math.round(seconds / 60),
      tracks: Math.round(48 * Math.max(1, scale)),
      artists: Math.round(17 * Math.max(1, scale)),
      newArtists: 5,
      playedThroughRate: 0.72,
      saves: 9,
      previous: { plays: Math.round(plays * 0.8), minutes: Math.round((seconds / 60) * 0.78) },
    },
    activity,
    topArtists: ARTISTS.map(([name, artistPlays, minutes], index) => ({
      artistId: `guide-artist-${slug(name)}`,
      name,
      plays: Math.round(artistPlays * Math.max(1, scale)),
      minutes: Math.round(minutes * Math.max(1, scale)),
      tracks: Math.max(1, 6 - index),
      releaseId: `guide-release-${slug(name)}`,
      artworkUrl: null,
      hasUploadedArtwork: false,
      artworkRevision: 1,
    })),
    topTracks: TRACKS.map(([title, artistName, trackPlays, minutes]) => ({
      trackId: `guide-track-${slug(title)}`,
      title,
      artistId: `guide-artist-${slug(artistName)}`,
      artistName,
      releaseId: `guide-release-${slug(artistName)}`,
      releaseTitle: "First Light",
      artworkUrl: null,
      hasUploadedArtwork: false,
      artworkRevision: 1,
      plays: Math.round(trackPlays * Math.max(1, scale)),
      minutes: Math.round(minutes * Math.max(1, scale)),
      available: true,
    })),
    genres: [
      { name: "Afrobeats", plays: 46, share: 0.354 },
      { name: "Neo soul", plays: 31, share: 0.238 },
      { name: "Deep house", plays: 22, share: 0.169 },
      { name: "Jazz", plays: 14, share: 0.108 },
      { name: "Ambient", plays: 9, share: 0.069 },
    ],
    moods: [
      { name: "Warm", plays: 52, share: 0.47 },
      { name: "Uplifting", plays: 38, share: 0.345 },
      { name: "Dreamy", plays: 26, share: 0.236 },
      { name: "Late night", plays: 17, share: 0.155 },
      { name: "Focused", plays: 10, share: 0.091 },
    ],
    moments: { morning: Math.round(plays * 0.18), afternoon: Math.round(plays * 0.14), evening: Math.round(plays * 0.56), night: Math.round(plays * 0.12) },
    weekdayPlays: Math.round(plays * 0.64),
    weekendPlays: Math.round(plays * 0.36),
  };
}

/** The same window with nothing played, for the empty state. */
export function emptyListeningStatsMock(days = 30, now = new Date(), recording = true) {
  return {
    ...listeningStatsMock(days, now),
    recording,
    summary: {
      plays: 0, minutes: 0, tracks: 0, artists: 0, newArtists: 0, playedThroughRate: null, saves: 0,
      previous: { plays: 0, minutes: 0 },
    },
    activity: [],
    topArtists: [],
    topTracks: [],
    genres: [],
    moods: [],
    moments: { morning: 0, afternoon: 0, evening: 0, night: 0 },
    weekdayPlays: 0,
    weekendPlays: 0,
  };
}
