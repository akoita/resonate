/**
 * A fake backend for the Home load-cost probe (`npm run perf:load`).
 *
 * The probe measures what the browser has to do in the first seconds after
 * someone opens Home, so Home has to look like it does for a real listener:
 * a featured campaign with photographic artwork, a personalized feed, the
 * popularity rails, a catalog snapshot with covers, public playlists and a
 * track in the player. Browser-side route mocks cannot provide the images,
 * because the Next image optimizer fetches them on the server, so this is a
 * small HTTP server on the API port instead.
 *
 * All names and numbers are invented and all artwork is generated here from a
 * seed (noise, gradients and soft shapes, encoded as JPEG so decode cost is
 * comparable to a photo). Nothing refers to a real artist or venue.
 *
 * Plain ESM. `sharp` ships with Next, so there is nothing extra to install.
 */
import http from "node:http";
import sharp from "sharp";

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (days) => new Date(Date.now() + days * DAY_MS).toISOString();

function prng(seed) {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (state >>> 8) / 0xffffff;
  };
}

const artCache = new Map();

/**
 * A photo-like JPEG: a colour gradient, a few large soft discs and film-grain
 * noise. The noise matters: a flat gradient compresses to almost nothing and
 * decodes far faster than real artwork does.
 */
async function photoJpeg(seed, width, height) {
  const key = `${seed}:${width}x${height}`;
  if (artCache.has(key)) return artCache.get(key);
  const rand = prng(seed);
  const hue = Math.round(rand() * 360);
  const discs = Array.from({ length: 7 }, () => {
    const cx = (rand() * width).toFixed(0);
    const cy = (rand() * height).toFixed(0);
    const r = ((0.12 + rand() * 0.3) * Math.min(width, height)).toFixed(0);
    const h = (hue + rand() * 90 - 45).toFixed(0);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${h} 80% ${(35 + rand() * 35).toFixed(0)}%)" opacity="${(0.25 + rand() * 0.4).toFixed(2)}" filter="url(#soft)"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 14%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 70% 38%)"/></linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="${Math.round(Math.min(width, height) / 40)}"/></filter>
</defs>
<rect width="100%" height="100%" fill="url(#g)"/>${discs}</svg>`;
  const noise = await sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 26 } },
  })
    .png()
    .toBuffer();
  const buffer = await sharp(Buffer.from(svg))
    .composite([{ input: noise, blend: "soft-light" }])
    .jpeg({ quality: 86 })
    .toBuffer();
  artCache.set(key, buffer);
  return buffer;
}

const GENRES = ["Electronic", "Pop", "Afrobeat", "Hip Hop", "Indie", "Jazz"];
const MOODS = ["Focus", "Hype", "Chill", "Late Night"];
const STEM_TYPES = ["vocals", "drums", "bass", "other"];
const ARTISTS = [
  "Mira Solène", "Kofi Arden", "Juno Vale", "Tariq Oyelaran", "Lena Hartmann", "Ose Baptiste",
  "Niko Farrow", "Amara Dessin", "Theo Lindqvist", "Sade Okonjo", "Ravi Monteiro", "Elin Storm",
];
const TITLES = [
  "Glasshouse", "Night Ferry", "Low Sun", "Paper Lanterns", "Harbour Lights", "Second Wind",
  "Slow Bloom", "Copper Sky", "Afterglow", "Field Notes", "Tidewater", "Open Rooms",
  "Soft Machines", "Late Bus Home", "Quiet Riot", "Marigold", "North Star", "Half Moon",
  "Warm Static", "Blue Hour", "Good Company", "Salt Air", "Long Way Round", "First Light",
];

export const MOCK_TRACK_ID = "trk_load_0_0";

function buildReleases() {
  return TITLES.map((title, index) => {
    const artistIndex = index % ARTISTS.length;
    const id = `rel_load_${index}`;
    const artist = ARTISTS[artistIndex];
    const genre = GENRES[index % GENRES.length];
    const tracks = Array.from({ length: 1 + (index % 3) }, (_, position) => {
      const trackId = `trk_load_${index}_${position}`;
      return {
        id: trackId,
        releaseId: id,
        title: position === 0 ? title : `${title} (Part ${position + 1})`,
        position: position + 1,
        explicit: false,
        artist,
        createdAt: iso(-index - 1),
        artworkMimeType: "image/jpeg",
        processingStatus: "complete",
        stems: [
          { id: `${trackId}_master`, trackId, type: "master", uri: `/catalog/releases/${id}/tracks/${trackId}/stream`, durationSeconds: 204 },
          ...(index % 2 === 0
            ? STEM_TYPES.map((type) => ({
                id: `${trackId}_${type}`,
                trackId,
                type,
                uri: `/catalog/stems/${trackId}_${type}/preview`,
                durationSeconds: 204,
                source: "separated",
              }))
            : []),
        ],
      };
    });
    return {
      id,
      artistId: `art_load_${artistIndex}`,
      title,
      status: "ready",
      type: tracks.length > 1 ? "EP" : "SINGLE",
      primaryArtist: artist,
      genre,
      moods: [MOODS[index % MOODS.length]],
      releaseDate: iso(-index - 1),
      explicit: false,
      createdAt: iso(-index - 1),
      artworkMimeType: "image/jpeg",
      artworkRevision: 1,
      tracks,
      artist: { id: `art_load_${artistIndex}`, displayName: artist },
      artistCredits: [{ artistId: `art_load_${artistIndex}`, name: artist, role: "primary", position: 0 }],
    };
  });
}

const RELEASES = buildReleases();

const CAMPAIGN_SEEDS = [
  ["Mira Solène", "Brooklyn", "US", 0.53],
  ["Kofi Arden", "Montréal", "CA", 0.78],
  ["Juno Vale", "Paris", "FR", 0.67],
  ["Tariq Oyelaran", "Dublin", "IE", 0.42],
];

function buildCampaigns() {
  return CAMPAIGN_SEEDS.map(([artist, city, country, funded], index) => {
    const id = `cmp_load_${index}`;
    const goal = 2_000_000_000;
    return {
      id,
      slug: `load-campaign-${index}`,
      artistId: `art_load_${index}`,
      artistDisplayName: artist,
      title: `${artist} in ${city}`,
      city,
      country,
      venueTarget: "Main Hall",
      targetDate: iso(120 + index * 10),
      deadline: iso(20 + index * 3),
      bookingDeadline: iso(60 + index * 3),
      goalAmountUnits: String(goal),
      raisedAmountUnits: String(Math.round(goal * funded)),
      currency: "USD",
      paymentAssetSymbol: "USDC",
      paymentAssetDecimals: 6,
      minimumBackers: 200,
      confirmedPledgeCount: Math.round(300 * funded),
      uniqueBackerCount: Math.round(280 * funded),
      status: "active",
      campaignLevel: "active_escrow_campaign",
      artistAuthorityStatus: "artist_authorized",
      description: `${city} already answers this music: a crowd ready to sing every refrain back. This sample campaign imagines the night it could happen.`,
      visuals: [
        { id: "hero", role: "hero", publicUrl: `/shows/campaigns/${id}/visuals/hero`, artworkRevision: 1, sortOrder: 0 },
        { id: "card", role: "card", publicUrl: `/shows/campaigns/${id}/visuals/card`, artworkRevision: 1, sortOrder: 1 },
      ],
      tiers: [
        { id: `${id}_tier`, title: "General admission", amountUnits: "35000000", currency: "USD", paymentAssetSymbol: "USDC", paymentAssetDecimals: 6 },
      ],
    };
  });
}

const feedItem = (release, reason) => ({
  id: release.tracks[0].id,
  title: release.tracks[0].title,
  artist: release.primaryArtist,
  artistId: release.artistId,
  releaseId: release.id,
  releaseTitle: release.title,
  genre: release.genre,
  moods: release.moods,
  artworkMimeType: "image/jpeg",
  artworkRevision: 1,
  reasons: [reason],
});

const homeFeed = () => ({
  userId: "test-user",
  requestId: "req-load",
  cold: false,
  rails: [
    {
      id: "listening_genre",
      kind: "listening_genre",
      title: "Because you’ve been playing Pop",
      explanation: "From what you’ve been playing lately — it shifts as your listening changes.",
      items: RELEASES.slice(0, 10).map((release) => feedItem(release, "genre:Pop")),
    },
    {
      id: "new_from_artists",
      kind: "new_from_artists",
      title: "New from artists you play",
      explanation: "Fresh releases from artists in your recent listening.",
      items: RELEASES.slice(10, 20).map((release) => feedItem(release, "artist")),
    },
  ],
});

const popularity = (items) => ({ window: "7d", genre: null, minimumAudience: 3, items });

const trending = () =>
  popularity(
    RELEASES.slice(4, 12).map((release, index) => ({
      rank: index + 1,
      trackId: release.tracks[0].id,
      title: release.tracks[0].title,
      artist: release.primaryArtist,
      artistId: release.artistId,
      releaseId: release.id,
      releaseTitle: release.title,
      genre: release.genre,
      artworkUrl: null,
      artworkMimeType: "image/jpeg",
      artworkRevision: 1,
      score: 40 - index,
      plays: 120 - index * 9,
      uniqueListeners: 60 - index * 4,
      saves: 12 - index,
    })),
  );

const topArtists = () =>
  popularity(
    ARTISTS.slice(0, 8).map((name, index) => ({
      rank: index + 1,
      artistId: `art_load_${index}`,
      name,
      imageUrl: null,
      score: 50 - index,
      plays: 200 - index * 11,
      uniqueListeners: 80 - index * 5,
      saves: 20 - index,
    })),
  );

const playlists = () =>
  Array.from({ length: 8 }, (_, index) => ({
    id: `pl_load_${index}`,
    name: ["Sunday Reset", "Deep Work", "Roof Party", "Night Drive", "First Coffee", "Slow Jams", "Gym Hour", "Rain Day"][index],
    ownerUserId: `user_load_${index}`,
    ownerDisplayName: ARTISTS[index],
    trackCount: 12 + index,
    playableTrackCount: 12 + index,
    coverArtworkPaths: RELEASES.slice(index, index + 4).map((release) => `/catalog/releases/${release.id}/artwork/v1`),
    createdAt: iso(-10 - index),
    updatedAt: iso(-index),
  }));

function cors(req, res) {
  // Any origin, no credentials: the app authenticates with a bearer header,
  // and everything served here is made-up data.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
}

/**
 * Starts the fake API. `latencyMs` delays every JSON answer so requests settle
 * a little apart, as they do against a real backend.
 */
export async function startHomeLoadMockApi({ port = 3000, latencyMs = 80 } = {}) {
  const campaigns = buildCampaigns();
  // Draw every picture before the first request: generating them on demand is
  // slow enough to time out the image optimizer's upstream fetch.
  for (const release of RELEASES) await photoJpeg(release.id, 1400, 1400);
  for (const campaign of campaigns) {
    for (const visual of campaign.visuals) await photoJpeg(`${campaign.id}:${visual.id}`, 2400, 1600);
  }
  const server = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url, `http://localhost:${port}`);
    const { pathname } = url;
    const json = (body, status = 200) => {
      setTimeout(() => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      }, latencyMs);
    };
    const image = async (seed, width, height) => {
      const body = await photoJpeg(seed, width, height);
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": body.length,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(body);
    };
    try {
      const artwork = /^\/catalog\/releases\/([^/]+)\/artwork(?:\/v\d+)?$/.exec(pathname);
      if (artwork) return await image(artwork[1], 1400, 1400);
      const visual = /^\/shows\/campaigns\/([^/]+)\/visuals\/([^/]+)(?:\/v\d+)?$/.exec(pathname);
      if (visual) return await image(`${visual[1]}:${visual[2]}`, 2400, 1600);
      if (pathname === "/shows/campaigns") return json(campaigns);
      if (pathname === "/catalog/published") return json(RELEASES);
      if (pathname === "/catalog/me") return json(RELEASES.slice(0, 4));
      if (pathname === "/catalog/trending") return json(trending());
      if (pathname === "/catalog/top-artists") return json(topArtists());
      if (pathname === "/catalog/playlists") return json(playlists());
      if (/^\/recommendations\/[^/]+\/home-feed$/.test(pathname)) return json(homeFeed());
      const release = /^\/catalog\/releases\/([^/]+)$/.exec(pathname);
      if (release) {
        const found = RELEASES.find((item) => item.id === release[1]);
        return found ? json(found) : json({ message: "Not found" }, 404);
      }
      const track = /^\/catalog\/tracks\/([^/]+)$/.exec(pathname);
      if (track) {
        const owner = RELEASES.find((item) => item.tracks.some((entry) => entry.id === track[1]));
        const found = owner?.tracks.find((entry) => entry.id === track[1]);
        return found ? json({ ...found, release: { ...owner, tracks: undefined } }) : json({ message: "Not found" }, 404);
      }
      // Everything else: an honest 404, which the app tolerates.
      return json({ message: "Not found" }, 404);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      console.error("home-load mock API:", error);
      res.end(JSON.stringify({ message: "Mock API error" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_API_PORT ?? 3000);
  startHomeLoadMockApi({ port }).then(() => console.log(`Home load mock API on http://localhost:${port}`));
}
