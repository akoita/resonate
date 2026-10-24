/**
 * A small, fully fake backend for the User Guide screenshots of the public
 * Shows and Marketplace pages (#1846), so those pictures need no hosted
 * environment and no real catalog.
 *
 * The Shows pages read their campaigns on the Next.js server and the
 * Marketplace reads listings through a Next.js route that proxies the backend,
 * so browser-side route mocks cannot reach either. Instead this module starts a
 * tiny HTTP server on the backend's port (`API_BASE_URL`, default
 * http://localhost:3000) that answers the same routes with fixed sample data:
 *
 *   GET /shows/campaigns, /shows/campaigns/:slug  six live, pledgeable campaigns
 *   GET /metadata/listings                        stem listings (all license tiers, both sources)
 *   GET /api/stem-pricing/batch-get               tier prices for the cards
 *   GET /payments/assets                          one USDC test asset
 *   GET /guide-art/*.svg                          generated cover and banner art
 *
 * Everything else answers 404, which the app already tolerates.
 *
 * All names, places and numbers are invented sample data and all art is
 * generated here from a seed (abstract shapes, no photos, no lettering), so
 * nothing refers to a real artist, a real venue or a real person. Dates are
 * relative to "now" so a campaign never appears expired.
 *
 * Plain ESM with no dependencies so the capture script runs under plain Node.
 */

import http from "node:http";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The test token every sample listing and campaign is priced in. */
export const GUIDE_USDC = "0x00000000000000000000000000000000000000a0";
const GUIDE_ESCROW = "0x00000000000000000000000000000000000000e5";
const GUIDE_BENEFICIARY = "0x00000000000000000000000000000000000000b1";
const GUIDE_SELLER = "0x00000000000000000000000000000000000000c7";

/** The campaign the guide's campaign-page picture shows. */
export const GUIDE_FEATURED_CAMPAIGN_SLUG = "nadia-okoro-paris";

// ── Generated art ────────────────────────────────────────────────────────

/** Small deterministic PRNG so the same seed always draws the same picture. */
function prng(seed) {
  let state = 0;
  for (const char of seed) state = (Math.imul(state, 31) + char.charCodeAt(0)) >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (state >>> 8) / 0xffffff;
  };
}

const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`;

/**
 * A wide banner: a night sky, a large glowing disc and layered skyline
 * silhouettes in the same hue family.
 */
function bannerSvg(seed, hue, width, height) {
  const rand = prng(seed);
  const skyTop = hsl(hue, 55, 9);
  const skyMid = hsl(hue + 18, 62, 24);
  const skyLow = hsl(hue + 38, 78, 52);
  const discX = width * (0.55 + rand() * 0.25);
  const discY = height * (0.42 + rand() * 0.1);
  const discR = height * (0.2 + rand() * 0.06);
  const layers = [];
  for (let layer = 0; layer < 3; layer += 1) {
    const base = height * (0.66 + layer * 0.1);
    const lightness = 16 - layer * 4;
    let x = -20;
    const rects = [];
    while (x < width + 20) {
      const w = width * (0.018 + rand() * 0.035);
      const h = height * (0.06 + rand() * (0.18 - layer * 0.03));
      rects.push(`<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${(height - base + h).toFixed(1)}"/>`);
      x += w + width * rand() * 0.004;
    }
    layers.push(`<g fill="${hsl(hue + 10, 45, lightness)}">${rects.join("")}</g>`);
  }
  const stars = Array.from({ length: 36 }, () => {
    const sx = rand() * width;
    const sy = rand() * height * 0.45;
    return `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(0.7 + rand() * 1.4).toFixed(1)}" fill="#fff" opacity="${(0.25 + rand() * 0.5).toFixed(2)}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="0.55" stop-color="${skyMid}"/><stop offset="1" stop-color="${skyLow}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${hsl(hue + 50, 95, 82)}"/><stop offset="0.55" stop-color="${hsl(hue + 40, 90, 62)}" stop-opacity="0.55"/><stop offset="1" stop-color="${hsl(hue + 30, 90, 55)}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${width}" height="${height}" fill="url(#sky)"/>
${stars}
<circle cx="${discX.toFixed(1)}" cy="${discY.toFixed(1)}" r="${(discR * 2.6).toFixed(1)}" fill="url(#glow)"/>
<circle cx="${discX.toFixed(1)}" cy="${discY.toFixed(1)}" r="${discR.toFixed(1)}" fill="${hsl(hue + 52, 92, 86)}" opacity="0.95"/>
${layers.join("")}
</svg>`;
}

/**
 * A square cover: a gradient field with concentric rings and a row of
 * waveform bars, a stand-in for a release cover.
 */
function coverSvg(seed, hue, size) {
  const rand = prng(seed);
  const cx = size * (0.38 + rand() * 0.24);
  const cy = size * (0.34 + rand() * 0.2);
  const rings = Array.from({ length: 6 }, (_, index) => {
    const radius = size * (0.08 + index * 0.075);
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="none" stroke="${hsl(hue + 40, 90, 80)}" stroke-width="${(2 + rand() * 3).toFixed(1)}" opacity="${(0.55 - index * 0.07).toFixed(2)}"/>`;
  }).join("");
  const bars = [];
  const barCount = 28;
  const barWidth = size / (barCount * 1.6);
  for (let index = 0; index < barCount; index += 1) {
    const envelope = Math.sin((index / barCount) * Math.PI);
    const barHeight = size * (0.04 + envelope * 0.16 * (0.4 + rand() * 0.6));
    const x = size * 0.08 + index * barWidth * 1.6;
    bars.push(`<rect x="${x.toFixed(1)}" y="${(size * 0.84 - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="${(barWidth / 2).toFixed(1)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<defs>
<linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hsl(hue, 70, 22)}"/><stop offset="0.6" stop-color="${hsl(hue + 28, 72, 40)}"/><stop offset="1" stop-color="${hsl(hue + 60, 80, 58)}"/></linearGradient>
<radialGradient id="spot" cx="${(cx / size).toFixed(2)}" cy="${(cy / size).toFixed(2)}" r="0.55"><stop offset="0" stop-color="${hsl(hue + 50, 95, 75)}" stop-opacity="0.75"/><stop offset="1" stop-color="${hsl(hue + 50, 95, 75)}" stop-opacity="0"/></radialGradient>
<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.62"/><stop offset="0.28" stop-color="#000" stop-opacity="0.3"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${size}" height="${size}" fill="url(#field)"/>
<rect width="${size}" height="${size}" fill="url(#spot)"/>
<rect width="${size}" height="${size}" fill="url(#shade)"/>
${rings}
<g fill="${hsl(hue + 48, 90, 92)}" opacity="0.9">${bars.join("")}</g>
</svg>`;
}

/** `/guide-art/<kind>-<hue>-<seed>.svg` -> the SVG source, or null. */
function artFor(name) {
  const match = /^(banner|card|cover)-(\d{1,3})-([a-z0-9-]+)\.svg$/.exec(name);
  if (!match) return null;
  const [, kind, hueText, seed] = match;
  const hue = Number(hueText);
  if (kind === "banner") return bannerSvg(`${seed}:banner`, hue, 1600, 700);
  if (kind === "card") return bannerSvg(`${seed}:card`, hue, 800, 600);
  return coverSvg(`${seed}:cover`, hue, 640);
}

const artPath = (kind, hue, seed) => `/guide-art/${kind}-${hue}-${seed}.svg`;

// ── Sample campaigns ─────────────────────────────────────────────────────

/** USDC has six decimals; the app shows whole-currency progress. */
const usd = (amount) => String(Math.round(amount * 1_000_000));

/**
 * @param {Record<string, any>} base
 * @param {number} now
 */
function campaignDto(base, now) {
  const dayOffset = (days) => new Date(now + days * DAY_MS).toISOString();
  const tiers = base.tierAmounts.map(([title, amount, description]) => ({
    id: `${base.slug}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title,
    description,
    amountUnits: usd(amount),
    currency: base.currency,
    paymentAssetSymbol: "USDC",
    paymentAssetDecimals: 6,
  }));
  return {
    id: `guide-campaign-${base.slug}`,
    slug: base.slug,
    artistId: null,
    sourceReleaseId: null,
    artistDisplayName: base.artist,
    artist: {
      imageUrl: artPath("cover", base.hue, `${base.slug}-artist`),
      summary: base.summary,
      socialLinks: {},
    },
    heroImageUrl: artPath("banner", base.hue, base.slug),
    cardImageUrl: artPath("card", base.hue, base.slug),
    visuals: [
      { id: `${base.slug}-hero`, role: "hero", publicUrl: artPath("banner", base.hue, base.slug), sortOrder: 0 },
      { id: `${base.slug}-card`, role: "card", publicUrl: artPath("card", base.hue, base.slug), sortOrder: 1 },
    ],
    title: base.title,
    description: base.tagline,
    city: base.city,
    country: base.country,
    venueTarget: base.venue,
    targetDate: dayOffset(base.showInDays),
    deadline: dayOffset(base.deadlineInDays),
    bookingDeadline: dayOffset(base.deadlineInDays + 30),
    goalAmountUnits: usd(base.goal),
    raisedAmountUnits: usd(base.raised),
    currency: base.currency,
    paymentAssetSymbol: "USDC",
    paymentAssetDecimals: 6,
    paymentTokenAddress: GUIDE_USDC,
    minimumBackers: base.minimumBackers,
    confirmedPledgeCount: base.backers,
    uniqueBackerCount: base.backers,
    status: "active",
    campaignLevel: "active_escrow_campaign",
    artistAuthorityStatus: "artist_authorized",
    beneficiaryAddress: GUIDE_BENEFICIARY,
    beneficiaryType: "artist_wallet",
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111),
    releasePolicy: "staged_release",
    depositReleaseBps: 1000,
    disputeWindowSeconds: 7 * 24 * 60 * 60,
    onChainStatus: "active",
    feeBps: 600,
    contractAddress: GUIDE_ESCROW,
    contractCampaignId: String(base.contractCampaignId),
    metadata: {},
    tiers,
  };
}

const CAMPAIGNS = [
  {
    slug: GUIDE_FEATURED_CAMPAIGN_SLUG,
    artist: "Nadia Okoro",
    title: "Nadia Okoro in Paris",
    city: "Paris",
    country: "FR",
    venue: "Riverside Hall",
    currency: "EUR",
    hue: 262,
    goal: 100_000,
    raised: 67_200,
    backers: 127,
    minimumBackers: 500,
    showInDays: 180,
    deadlineInDays: 21,
    contractCampaignId: 1,
    summary: "Songwriter and producer blending Afrobeats rhythms with warm, close-up vocals.",
    tagline: "A warm Paris night for a voice built to fill the room. Fans across Europe pool their pledges into one visible, refundable signal that the artist's team can act on.",
    tierAmounts: [
      ["Fan signal", 25, "Refundable support signal and campaign receipt."],
      ["Ticket intent", 75, "Priority allocation if the show is booked."],
      ["Patron circle", 250, "Premium campaign receipt and patron allocation."],
    ],
  },
  {
    slug: "hana-mori-lisbon",
    artist: "Hana Mori",
    title: "Hana Mori in Lisbon",
    city: "Lisbon",
    country: "PT",
    venue: "The Foundry",
    currency: "EUR",
    hue: 188,
    goal: 60_000,
    raised: 14_400,
    backers: 48,
    minimumBackers: 300,
    showInDays: 210,
    deadlineInDays: 33,
    contractCampaignId: 2,
    summary: "Jazz-leaning pianist and singer.",
    tagline: "An intimate seated evening of late-night piano songs by the water.",
    tierAmounts: [
      ["Fan signal", 20, "Refundable support signal and campaign receipt."],
      ["Ticket intent", 60, "Priority allocation if the show is booked."],
      ["Patron circle", 200, "Premium campaign receipt and patron allocation."],
    ],
  },
  {
    slug: "amara-sol-lagos",
    artist: "Amara Sol",
    title: "Amara Sol in Lagos",
    city: "Lagos",
    country: "NG",
    venue: "Harbour Arena",
    currency: "USD",
    hue: 28,
    goal: 120_000,
    raised: 45_600,
    backers: 211,
    minimumBackers: 650,
    showInDays: 225,
    deadlineInDays: 35,
    contractCampaignId: 3,
    summary: "Singer-songwriter and bandleader.",
    tagline: "A full band, a full room and a hometown chorus on the waterfront.",
    tierAmounts: [
      ["Fan signal", 25, "Refundable support signal and campaign receipt."],
      ["Ticket intent", 75, "Priority allocation if the show is booked."],
      ["Patron circle", 250, "Premium campaign receipt and patron allocation."],
    ],
  },
  {
    slug: "night-courier-montreal",
    artist: "Night Courier",
    title: "Night Courier in Montréal",
    city: "Montréal",
    country: "CA",
    venue: "Union Warehouse",
    currency: "USD",
    hue: 318,
    goal: 95_000,
    raised: 74_100,
    backers: 306,
    minimumBackers: 550,
    showInDays: 165,
    deadlineInDays: 12,
    contractCampaignId: 4,
    summary: "Electronic duo.",
    tagline: "Club-sized electronics for a crowd that already knows every drop.",
    tierAmounts: [
      ["Fan signal", 20, "Refundable support signal and campaign receipt."],
      ["Ticket intent", 60, "Priority allocation if the show is booked."],
      ["Patron circle", 220, "Premium campaign receipt and patron allocation."],
    ],
  },
  {
    slug: "paper-satellites-dublin",
    artist: "Paper Satellites",
    title: "Paper Satellites in Dublin",
    city: "Dublin",
    country: "IE",
    venue: "Canal Theatre",
    currency: "EUR",
    hue: 148,
    goal: 70_000,
    raised: 29_400,
    backers: 94,
    minimumBackers: 350,
    showInDays: 205,
    deadlineInDays: 28,
    contractCampaignId: 5,
    summary: "Indie band.",
    tagline: "Four voices, one stage and a theatre that suits quiet, story-led songs.",
    tierAmounts: [
      ["Fan signal", 25, "Refundable support signal and campaign receipt."],
      ["Ticket intent", 70, "Priority allocation if the show is booked."],
      ["Patron circle", 240, "Premium campaign receipt and patron allocation."],
    ],
  },
  {
    slug: "velvet-meridian-berlin",
    artist: "Velvet Meridian",
    title: "Velvet Meridian in Berlin",
    city: "Berlin",
    country: "DE",
    venue: "Gasworks Hall",
    currency: "EUR",
    hue: 8,
    goal: 85_000,
    raised: 53_550,
    backers: 172,
    minimumBackers: 420,
    showInDays: 190,
    deadlineInDays: 17,
    contractCampaignId: 6,
    summary: "Synth-pop trio.",
    tagline: "Neon synths in a converted gasworks, with the crowd on the floor.",
    tierAmounts: [
      ["Fan signal", 25, "Refundable support signal and campaign receipt."],
      ["Ticket intent", 75, "Priority allocation if the show is booked."],
      ["Patron circle", 250, "Premium campaign receipt and patron allocation."],
    ],
  },
];

// ── Sample marketplace listings ──────────────────────────────────────────

const STEMS = [
  {
    id: "guide-stem-golden-road-vocals", title: "Vocals Stem", type: "vocals", track: "Golden Road", artist: "Nadia Okoro",
    genre: "World Music", hue: 262, source: "official", tiers: { personal: 3, remix: 12, commercial: 40 }, left: 25,
  },
  {
    id: "guide-stem-lantern-season-drums", title: "Drums Stem", type: "drums", track: "Lantern Season", artist: "Hana Mori",
    genre: "Jazz", hue: 188, source: "official", tiers: { personal: 2, remix: 8 }, left: 40,
  },
  {
    id: "guide-stem-signal-fire-bass", title: "Bass Stem", type: "bass", track: "Signal Fire", artist: "Night Courier",
    genre: "Electronic", hue: 318, source: "separated", separationModel: "demucs-htdemucs", tiers: { personal: 1.5 }, left: 100,
  },
  {
    id: "guide-stem-kora-sunrise-melody", title: "Melody Stem", type: "melody", track: "Kora Sunrise", artist: "Amara Sol",
    genre: "Afrobeats", hue: 28, source: "official", tiers: { personal: 2.5, commercial: 30 }, left: 15,
  },
  {
    id: "guide-stem-dune-radio-guitar", title: "Guitar Stem", type: "guitar", track: "Dune Radio", artist: "Nadia Okoro",
    genre: "World Music", hue: 340, source: "separated", separationModel: "demucs-htdemucs", tiers: { personal: 2, remix: 9 }, left: 60,
  },
  {
    id: "guide-stem-quiet-harbour-piano", title: "Piano Stem", type: "piano", track: "Quiet Harbour", artist: "Hana Mori",
    genre: "Jazz", hue: 205, source: "official", tiers: { personal: 3.5 }, left: 30,
  },
];

const TIER_ORDER = ["personal", "remix", "commercial"];

/** @param {number} now */
function listingsDto(now) {
  const listings = [];
  STEMS.forEach((stem, stemIndex) => {
    const ids = {};
    TIER_ORDER.forEach((tier) => {
      if (stem.tiers[tier] !== undefined) ids[tier] = `${(stemIndex + 1) * 10 + TIER_ORDER.indexOf(tier)}`;
    });
    TIER_ORDER.forEach((tier) => {
      const price = stem.tiers[tier];
      if (price === undefined) return;
      listings.push({
        listingId: ids[tier],
        tokenId: String((stemIndex + 1) * 100),
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111),
        seller: GUIDE_SELLER,
        price: usd(price),
        paymentToken: GUIDE_USDC,
        licenseType: tier,
        tierListings: ids,
        amount: String(stem.left),
        status: "active",
        expiresAt: new Date(now + (24 + stemIndex * 3) * DAY_MS).toISOString(),
        stem: {
          id: stem.id,
          title: stem.title,
          type: stem.type,
          track: stem.track,
          trackId: `guide-track-${stemIndex + 1}`,
          artist: stem.artist,
          genre: stem.genre,
          artworkUrl: artPath("cover", stem.hue, stem.id),
          uri: `/catalog/stems/${stem.id}/preview`,
          source: stem.source,
          separationModel: stem.separationModel ?? null,
        },
      });
    });
  });
  return listings;
}

/** Tier prices the cards show for tiers that are listed on their own. */
function pricingDto() {
  return Object.fromEntries(STEMS.map((stem) => [stem.id, {
    basePlayPriceUsd: stem.tiers.personal ?? 0,
    remixLicenseUsd: stem.tiers.remix ?? 0,
    commercialLicenseUsd: stem.tiers.commercial ?? 0,
  }]));
}

// ── Server ───────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/**
 * Answers one request. Exported so the sample data can be checked without a server.
 * @param {string} method
 * @param {URL} url
 * @param {number} [now]
 * @returns {{ status: number, type: string, body: string }}
 */
export function guideSeedResponse(method, url, now = Date.now()) {
  const json = (body, status = 200) => ({ status, type: "application/json", body: JSON.stringify(body) });
  if (method !== "GET") return json({ message: "Not found" }, 404);
  const { pathname } = url;

  if (pathname === "/shows/campaigns") {
    return json(CAMPAIGNS.map((campaign) => campaignDto(campaign, now)));
  }
  const campaignMatch = /^\/shows\/campaigns\/([^/]+)$/.exec(pathname);
  if (campaignMatch) {
    const key = decodeURIComponent(campaignMatch[1]);
    const found = CAMPAIGNS.map((campaign) => campaignDto(campaign, now))
      .find((campaign) => campaign.slug === key || campaign.id === key);
    return found ? json(found) : json({ message: "Not found" }, 404);
  }
  if (pathname === "/metadata/listings") {
    const source = url.searchParams.get("source");
    const listings = listingsDto(now).filter((listing) => source === null || source === "all" || listing.stem.source === source);
    return json({ listings, total: listings.length });
  }
  if (pathname === "/api/stem-pricing/batch-get") return json(pricingDto());
  if (pathname === "/payments/assets") {
    const chainId = Number(url.searchParams.get("chainId") || process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);
    return json({
      chainId,
      source: "env",
      defaultAsset: "usdc",
      assets: [{
        assetId: "usdc", chainId, symbol: "USDC", name: "USD Coin (test)", kind: "stablecoin",
        tokenAddress: GUIDE_USDC, decimals: 6, enabled: true, settlement: ["marketplace", "revenue_escrow"],
        pricingStrategy: "usd_pegged",
      }],
    });
  }
  const artMatch = /^\/guide-art\/([^/]+)$/.exec(pathname);
  if (artMatch) {
    const svg = artFor(artMatch[1]);
    if (svg) return { status: 200, type: "image/svg+xml", body: svg };
  }
  return json({ message: "Not found" }, 404);
}

/**
 * Starts the sample backend. Resolves once it is listening.
 * @param {{ port: number, host?: string }} options (no host: all interfaces, so `localhost` works over IPv4 and IPv6)
 * @returns {Promise<{ close: () => Promise<void> }>}
 */
export function startGuideSeedApi({ port, host }) {
  const server = http.createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://guide-seed.local");
    const answer = guideSeedResponse(request.method ?? "GET", url);
    response.writeHead(answer.status, { ...CORS, "Content-Type": answer.type, "Cache-Control": "no-store" });
    response.end(answer.body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve({
        close: () => new Promise((done) => {
          server.close(() => done(undefined));
          server.closeAllConnections?.();
        }),
      });
    });
  });
}
