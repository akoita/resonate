/**
 * Fully mocked data for the Official stems User Guide figures (#2379), so the
 * screenshots in `scripts/capture-help-screenshots.mjs` need no backend and
 * every run draws the same pictures. Plain ESM so the capture script runs under
 * plain Node. Fixed sample data; nothing here comes from a real artist.
 *
 * - `mockOfficialStemsRelease`: an artist's release page with one track that
 *   already has official vocals and bass next to its separated stems.
 * - `mockSourceListings`: Browse stems with the same part sold both as
 *   Official and as Separated (AI), honouring the `source` query the menu sends.
 */

import { QUOTE_CHAIN_ID, QUOTE_USDC } from "./crate-digger-mock.mjs";

export const OFFICIAL_STEMS_RELEASE_ID = "guide-official-release";
// The mock auth session's artist (web/tests/auth.setup.ts); the names shown are invented.
const ARTIST_ID = "test-artist-id";
const ARTIST_NAME = "Nadia Okoro";
const TIMESTAMP = "2026-10-20T09:00:00.000Z";

const separated = (trackId, type) => ({
  id: `${trackId}-${type}-sep`,
  type,
  uri: `/catalog/stems/${trackId}-${type}-sep/blob`,
  mimeType: "audio/mpeg",
  source: "separated",
  separationModel: "demucs-htdemucs-6s",
  isCurrent: true,
});
const official = (trackId, type) => ({
  id: `${trackId}-${type}-off`,
  type,
  uri: `/catalog/stems/${trackId}-${type}-off/blob`,
  mimeType: "audio/wav",
  source: "official",
  separationModel: null,
  isCurrent: true,
});

/** @param {import("@playwright/test").Page} page */
export async function mockOfficialStemsRelease(page) {
  const release = {
    id: OFFICIAL_STEMS_RELEASE_ID,
    artistId: ARTIST_ID,
    title: "Golden Road",
    type: "EP",
    status: "published",
    primaryArtist: ARTIST_NAME,
    genre: "Afro house",
    moods: [],
    rightsRoute: "STANDARD_ESCROW",
    createdAt: TIMESTAMP,
    explicit: false,
    artist: { id: ARTIST_ID, displayName: ARTIST_NAME, userId: "test-user" },
    tracks: [
      {
        id: "guide-golden-road",
        releaseId: OFFICIAL_STEMS_RELEASE_ID,
        title: "Golden Road",
        position: 1,
        processingStatus: "complete",
        contentStatus: "clean",
        explicit: false,
        stems: [
          separated("guide-golden-road", "vocals"),
          separated("guide-golden-road", "drums"),
          separated("guide-golden-road", "bass"),
          official("guide-golden-road", "vocals"),
          official("guide-golden-road", "bass"),
        ],
      },
      {
        id: "guide-lantern-season",
        releaseId: OFFICIAL_STEMS_RELEASE_ID,
        title: "Lantern Season",
        position: 2,
        processingStatus: "complete",
        contentStatus: "clean",
        explicit: false,
        stems: [separated("guide-lantern-season", "vocals"), separated("guide-lantern-season", "drums")],
      },
    ],
  };
  const id = OFFICIAL_STEMS_RELEASE_ID;
  await page.route(`**/catalog/me/releases/${id}`, (route) => route.fulfill({ json: release }));
  await page.route(`**/catalog/releases/${id}`, (route) => route.fulfill({ json: release }));
  await page.route(`**/metadata/content-protection/release/${id}`, (route) => route.fulfill({ status: 404 }));
  await page.route(`**/metadata/release-rights/releases/${id}`, (route) => route.fulfill({ json: null }));
  await page.route(`**/management/releases/${id}/access`, (route) => route.fulfill({ status: 404 }));
  // The prices panel below the official stems panel: no saved prices, no templates.
  await page.route("**/api/stem-pricing/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/stem-pricing/templates", (route) => route.fulfill({ json: [] }));
  await page.route("**/analytics/product-events", (route) => route.fulfill({ status: 202, json: { recorded: true } }));
}

const USDC = QUOTE_USDC;
const USDC_UNIT = 1_000_000n;

const LISTING_BASE = {
  chainId: QUOTE_CHAIN_ID,
  seller: "0x1111111111111111111111111111111111111111",
  paymentToken: USDC,
  licenseType: "personal",
  tierListings: null,
  amount: "10",
  status: "active",
  expiresAt: "2026-12-20T09:00:00.000Z",
};

/** A generated cover, so the guide never shows the placeholder disc. Served by `mockSourceListings`. */
export function coverSvg(hueA, hueB, shape) {
  const marks = {
    rings: '<circle cx="200" cy="200" r="120" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="14"/><circle cx="200" cy="200" r="60" fill="rgba(255,255,255,.5)"/>',
    bars: '<g fill="rgba(255,255,255,.5)"><rect x="90" y="150" width="34" height="120" rx="8"/><rect x="146" y="100" width="34" height="220" rx="8"/><rect x="202" y="130" width="34" height="160" rx="8"/><rect x="258" y="80" width="34" height="250" rx="8"/></g>',
    sun: '<circle cx="200" cy="170" r="86" fill="rgba(255,255,255,.55)"/><rect x="0" y="230" width="400" height="170" fill="rgba(0,0,0,.28)"/>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hueA} 55% 26%)"/><stop offset="1" stop-color="hsl(${hueB} 60% 14%)"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/>${marks[shape]}</svg>`;
}

const COVERS = {
  "golden-road": coverSvg(32, 350, "sun"),
  "lantern-season": coverSvg(262, 205, "rings"),
  "signal-fire": coverSvg(8, 300, "bars"),
};

const stemListing = (n, { title, type, track, cover, artist, source, genre = "Afro house", usdc }) => ({
  ...LISTING_BASE,
  listingId: String(9000 + n),
  tokenId: String(7000 + n),
  price: String(BigInt(usdc) * USDC_UNIT),
  stem: {
    id: `guide-listing-stem-${n}`,
    title,
    type,
    track,
    trackId: `guide-listing-track-${n}`,
    artist,
    genre,
    artworkUrl: `/guide-covers/${cover}.svg`,
    releaseId: `guide-listing-release-${n}`,
    artistId: `guide-listing-artist-${n}`,
    source,
    sourceLabel: source === "official" ? "Official" : "Separated (AI)",
    separationModel: source === "separated" ? "demucs-htdemucs-6s" : null,
  },
});

export const SOURCE_LISTINGS = [
  stemListing(1, { title: "Golden Road Vocals", type: "vocals", track: "Golden Road", cover: "golden-road", artist: ARTIST_NAME, source: "official", usdc: 6 }),
  stemListing(2, { title: "Golden Road Vocals", type: "vocals", track: "Golden Road", cover: "golden-road", artist: ARTIST_NAME, source: "separated", usdc: 3 }),
  stemListing(3, { title: "Golden Road Bass", type: "bass", track: "Golden Road", cover: "golden-road", artist: ARTIST_NAME, source: "official", usdc: 4 }),
  stemListing(4, { title: "Lantern Season Drums", type: "drums", track: "Lantern Season", cover: "lantern-season", artist: "Hana Mori", source: "separated", genre: "Downtempo", usdc: 3 }),
  stemListing(5, { title: "Signal Fire Guitar", type: "guitar", track: "Signal Fire", cover: "signal-fire", artist: "Night Courier", source: "official", genre: "Indie dance", usdc: 5 }),
  stemListing(6, { title: "Signal Fire Vocals", type: "vocals", track: "Signal Fire", cover: "signal-fire", artist: "Night Courier", source: "separated", genre: "Indie dance", usdc: 3 }),
];

/** @param {import("@playwright/test").Page} page */
export async function mockSourceListings(page) {
  await page.route("**/api/contracts/listings**", (route) => {
    const source = new URL(route.request().url()).searchParams.get("source");
    const listings = source ? SOURCE_LISTINGS.filter((listing) => listing.stem.source === source) : SOURCE_LISTINGS;
    return route.fulfill({ json: { listings, total: listings.length } });
  });
  // The covers the listings point at (the app prefixes the API origin).
  await page.route("**/guide-covers/*.svg", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()?.replace(".svg", "") ?? "";
    return COVERS[name]
      ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: COVERS[name] })
      : route.fulfill({ status: 404 });
  });
  // Prices are shown in USDC, like the marketplace guide image.
  await page.route("**/payments/assets**", (route) =>
    route.fulfill({
      json: {
        chainId: QUOTE_CHAIN_ID,
        defaultAsset: "local:usdc",
        source: "env",
        assets: [{
          assetId: "local:usdc", chainId: QUOTE_CHAIN_ID, symbol: "USDC", name: "USD Coin", kind: "stablecoin",
          tokenAddress: USDC, decimals: 6, enabled: true, settlement: ["marketplace"], pricingStrategy: "usd_pegged",
        }],
      },
    }),
  );
  await page.route("**/api/stem-pricing/batch-get**", (route) => route.fulfill({ json: {} }));
  await page.route("**/analytics/product-events", (route) => route.fulfill({ status: 202, json: { recorded: true } }));
}
