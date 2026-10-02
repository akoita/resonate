/**
 * A fully mocked Crate Digger API (#1963), shared by the Playwright flow in
 * `tests/crate-digger.spec.ts` and the User Guide screenshot capture
 * (`scripts/capture-help-screenshots.mjs`), so the guide's images and the
 * tested pages can't drift apart. No backend data is needed.
 *
 * The shapes mirror `backend/src/modules/crates/crate.dto.ts` and
 * `crate_quote.dto.ts`. The mock is stateful enough for the editing flow: PATCH
 * applies the title, status, order, locks and removals, and swap replaces a line
 * with a spare track. `POST /crates/:id/quote` prices the crate (#1964); the
 * signing path itself cannot run under mock auth, so settlement is only seeded
 * through `latestQuotes`.
 *
 * Plain ESM with JSDoc types so the capture script runs under plain Node.
 */

import { toneWav } from "./remix-studio-mock.mjs";

const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").origin;

/**
 * Matches API requests (never the app's own page navigations) by path.
 * @param {RegExp} pathPattern
 */
const apiPath = (pathPattern) => (/** @type {URL} */ url) =>
  url.origin === API_ORIGIN && pathPattern.test(url.pathname);

/**
 * The chain and marketplace the page is configured for: a quote is only
 * approvable for them. Run the dev server with the same `NEXT_PUBLIC_CHAIN_ID`
 * and `NEXT_PUBLIC_MARKETPLACE_ADDRESS` the tests run with (unset is fine: both
 * sides then use the defaults below).
 */
export const QUOTE_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);
export const QUOTE_MARKETPLACE =
  process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS
  || (QUOTE_CHAIN_ID === 31337
    ? "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853"
    : "0x0000000000000000000000000000000000000000");
export const QUOTE_USDC = "0x00000000000000000000000000000000000000a0";
/** The smart account the mock auth session signs with (the page sends it as `buyerAddress`). */
export const MOCK_BUYER = "0x742d35cc6634c0532925a3b844bc9e7595f1ea2c";
export const MOCK_QUOTE_HASH = `0x${"ab".repeat(32)}`;

export const CRATE_ID = "e2e-crate";
export const REFERENCE_CRATE_ID = "e2e-crate-reference";
export const REFERENCE_TRACK_ID = "track-reference";

/** The request text the flow types and the screenshot capture shows. */
export const CRATE_REQUEST_TEXT =
  "Eight melodic house tracks around 122-128 BPM in 8A or 9A, with vocals stems, under $20 each";

const STANDARD_GRANTS = {
  personal: ["Stream & collect — personal listening"],
  remix: ["Use in derivative works, publish remixes", "Includes personal rights"],
  commercial: [
    "Ads, films, products, monetized content",
    "Includes remix and personal rights",
  ],
};

/**
 * @param {"personal" | "remix" | "commercial" | "sync" | "sample" | "broadcast"} licenseType
 * @param {number | null} price
 * @param {boolean} [listed]
 */
function licenseOption(licenseType, price, listed = true) {
  const grants = STANDARD_GRANTS[/** @type {keyof typeof STANDARD_GRANTS} */ (licenseType)];
  return {
    licenseType,
    listed,
    indicativePriceUsd: price,
    standardTerms: Boolean(grants),
    grants: grants ? [...grants] : [],
  };
}

/**
 * @param {Record<string, any>} base
 */
function line(base) {
  const options = base.licenseOptions;
  return {
    position: 0,
    locked: false,
    artistId: "artist-1",
    available: true,
    explanation: [],
    verifiedHuman: true,
    aiDisclosureLevel: "NONE",
    transitionToNext: null,
    originalStemId: `stem-original-${base.trackId}`,
    listedLicenseTypes: options.filter((o) => o.listed).map((o) => o.licenseType),
    indicativePriceUsd: Object.fromEntries(
      options.filter((o) => o.indicativePriceUsd !== null).map((o) => [o.licenseType, o.indicativePriceUsd]),
    ),
    ...base,
    stemTypes: base.stems.map((s) => s.type),
  };
}

/** The six lines a built crate starts with. */
export function crateLines() {
  return [
    line({
      trackId: "track-neon-drift",
      title: "Neon Drift",
      artistName: "Aya Volt",
      tempoBpm: 122,
      camelot: "8A",
      energy: 0.42,
      linePriceUsd: 9.5,
      explanation: ["Tempo in range", "Key 8A"],
      stems: [
        { type: "bass", qualityScore: 68 },
        { type: "drums", qualityScore: 74 },
        { type: "vocals", qualityScore: 82 },
      ],
      licenseOptions: [
        licenseOption("personal", 1.5),
        licenseOption("remix", 9.5),
        licenseOption("commercial", 24),
      ],
    }),
    line({
      trackId: "track-glass-harbour",
      title: "Glass Harbour",
      artistName: "Mira Okoye",
      tempoBpm: 124,
      camelot: "9A",
      energy: 0.51,
      linePriceUsd: 12,
      stems: [
        { type: "bass", qualityScore: 71 },
        { type: "drums", qualityScore: 88 },
        { type: "piano", qualityScore: null },
        { type: "vocals", qualityScore: 79 },
      ],
      licenseOptions: [
        licenseOption("personal", 2),
        licenseOption("remix", 12),
        licenseOption("sync", 60),
      ],
    }),
    line({
      trackId: "track-midnight-courier",
      title: "Midnight Courier",
      artistName: "Night Courier",
      artistId: "artist-3",
      tempoBpm: 125,
      camelot: "8B",
      energy: 0.58,
      linePriceUsd: 11,
      aiDisclosureLevel: "PARTLY",
      verifiedHuman: false,
      stems: [
        { type: "drums", qualityScore: 66 },
        { type: "guitar", qualityScore: 59 },
        { type: "vocals", qualityScore: 73 },
      ],
      licenseOptions: [licenseOption("personal", 1.5), licenseOption("remix", 11)],
    }),
    line({
      trackId: "track-paper-lanterns",
      title: "Paper Lanterns",
      artistName: "Hollis Reed",
      artistId: "artist-4",
      available: false,
      tempoBpm: 126,
      camelot: "9A",
      energy: 0.66,
      linePriceUsd: null,
      originalStemId: null,
      stems: [{ type: "vocals", qualityScore: 64 }],
      licenseOptions: [],
    }),
    line({
      trackId: "track-saltwater",
      title: "Saltwater",
      artistName: "Mira Okoye",
      tempoBpm: 126,
      camelot: "10A",
      energy: null,
      linePriceUsd: 14,
      stems: [
        { type: "bass", qualityScore: 80 },
        { type: "vocals", qualityScore: 91 },
      ],
      licenseOptions: [licenseOption("personal", 2), licenseOption("remix", 14)],
    }),
    line({
      trackId: "track-last-train",
      title: "Last Train to Nowhere",
      artistName: "Aya Volt",
      tempoBpm: 128,
      camelot: "11A",
      energy: 0.85,
      linePriceUsd: 16.5,
      stems: [
        { type: "drums", qualityScore: 85 },
        { type: "vocals", qualityScore: 77 },
      ],
      licenseOptions: [
        licenseOption("personal", 2.5),
        licenseOption("remix", 16.5),
        licenseOption("commercial", 40),
      ],
    }),
  ];
}

/** The track a swap brings in. */
export function spareLine() {
  return line({
    trackId: "track-copper-sky",
    title: "Copper Sky",
    artistName: "Hollis Reed",
    artistId: "artist-4",
    tempoBpm: 125,
    camelot: "9B",
    energy: 0.55,
    linePriceUsd: 10,
    explanation: ["Close to the line it replaces"],
    stems: [
      { type: "drums", qualityScore: 70 },
      { type: "vocals", qualityScore: 75 },
    ],
    licenseOptions: [licenseOption("personal", 1.5), licenseOption("remix", 10)],
  });
}

export function defaultFilters() {
  return {
    count: 8,
    bpm: { min: 122, max: 128 },
    keys: ["8A", "9A"],
    includeCamelotNeighbors: true,
    energy: null,
    requiredStems: ["vocals"],
    licenseType: null,
    maxTotalUsd: null,
    maxPerItemUsd: 20,
    verifiedHumanOnly: false,
    allowFullyAi: false,
    genres: [],
    moods: [],
  };
}

/** Same rules as the backend's Camelot relation: same, neighbor, clash, unknown. */
function relation(a, b) {
  const parse = (code) => {
    const match = /^(\d{1,2})([AB])$/.exec(code ?? "");
    return match ? { n: Number(match[1]), l: match[2] } : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return "unknown";
  if (left.n === right.n && left.l === right.l) return "same";
  if (left.n === right.n) return "neighbor";
  const wrap = (n) => ((((n - 1) % 12) + 12) % 12) + 1;
  if (left.l === right.l && (wrap(left.n - 1) === right.n || wrap(left.n + 1) === right.n)) {
    return "neighbor";
  }
  return "clash";
}

/** Renumber lines and refresh `transitionToNext` like the backend does. */
function arrange(items) {
  return items.map((item, position) => {
    const next = items[position + 1];
    return {
      ...item,
      position,
      transitionToNext: next
        ? {
            harmonic: relation(item.camelot, next.camelot),
            bpmDelta:
              item.tempoBpm === null || next.tempoBpm === null
                ? null
                : Math.round((next.tempoBpm - item.tempoBpm) * 10) / 10,
            energyDelta:
              item.energy === null || next.energy === null
                ? null
                : Math.round((next.energy - item.energy) * 1000) / 1000,
          }
        : null,
    };
  });
}

/**
 * @param {string} id
 * @param {{ title?: string | null; status?: string; filters?: Record<string, any>; items?: Array<Record<string, any>> }} [overrides]
 */
export function mockCrate(id, overrides = {}) {
  return {
    id,
    status: "draft",
    title: null,
    filters: defaultFilters(),
    createdAt: "2026-09-28T09:00:00.000Z",
    updatedAt: "2026-09-28T09:00:00.000Z",
    entitlements: {
      pro: { allowed: true, reason: "free_for_everyone", policyVersion: "crate-pro-policy/v1" },
    },
    ...overrides,
    items: arrange(overrides.items ?? crateLines()),
  };
}

/* ------------------------------------------------------------------ */
/* Quotes (#1964)                                                      */
/* ------------------------------------------------------------------ */

/** What one stem costs at each tier, in USD (a stand-in for the chain's price). */
const STEM_USD = { personal: 0.5, remix: 2, commercial: 5 };
const FALLBACK_STEM_USD = 10;

/** USDC has six decimals. */
const toUnits = (usd) => BigInt(Math.round(usd * 1_000_000));

/** @param {bigint} units */
function formatUsdc(units) {
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** @param {bigint} units */
const usdOf = (units) => formatUsdc(units);

/**
 * Builds a quote the way the backend does: the DJ's per-line tier and stems, else
 * the cheapest listed tier and the crate's required stems (else every stem).
 * `Midnight Courier`'s vocals are sold out, and a tier the track does not list
 * is `not_listed`, so a default quote always shows dropped stems with reasons.
 *
 * @param {Record<string, any>} crate
 * @param {{ lines?: Array<{ trackId: string; licenseType?: string; stemTypes?: string[] }>; buyerAddress?: string }} body
 * @param {{ number: number; expiresInMs: number; nowMs?: number; status?: string; transactionHash?: string | null }} options
 */
export function buildQuote(crate, body, options) {
  const requested = new Map((body.lines ?? []).map((line) => [line.trackId, line]));
  const targets = crate.items.filter((item) => !body.lines || requested.has(item.trackId));
  let listingId = 100;
  let total = 0n;
  const lines = targets.map((item, position) => {
    const request = requested.get(item.trackId);
    const listed = item.licenseOptions.filter((option) => option.listed);
    const tier = request?.licenseType ?? listed[0]?.licenseType ?? "personal";
    const wanted =
      request?.stemTypes?.length
        ? request.stemTypes
        : crate.filters.requiredStems.length > 0
          ? crate.filters.requiredStems
          : item.stems.map((stem) => stem.type);
    const stemTypes = item.stems.map((stem) => stem.type).filter((type) => wanted.includes(type));
    const tierListed = listed.some((option) => option.licenseType === tier);
    const grants = STANDARD_GRANTS[/** @type {keyof typeof STANDARD_GRANTS} */ (tier)];
    const items = stemTypes.map((stemType) => {
      const quoteLineId = `ql-${options.number}-${item.trackId}-${stemType}`;
      const base = {
        quoteLineId,
        stemId: `stem-${item.trackId}-${stemType}`,
        stemType,
        receipt: null,
      };
      const dropReason = !item.available || !tierListed
        ? "not_listed"
        : item.trackId === "track-midnight-courier" && stemType === "vocals"
          ? "sold_out"
          : null;
      if (dropReason) {
        return {
          ...base,
          status: "dropped",
          reason: dropReason,
          listingId: null,
          tokenId: null,
          paymentToken: null,
          symbol: null,
          decimals: null,
          totalUnits: null,
          total: null,
          totalUsd: null,
          artistShareUnits: null,
          platformFeeUnits: null,
        };
      }
      const units = toUnits(STEM_USD[tier] ?? FALLBACK_STEM_USD);
      const fee = (units * 10n) / 100n;
      total += units;
      listingId += 1;
      return {
        ...base,
        status: "quoted",
        reason: null,
        listingId: String(listingId),
        tokenId: String(listingId * 10),
        paymentToken: QUOTE_USDC,
        symbol: "USDC",
        decimals: 6,
        totalUnits: units.toString(),
        total: formatUsdc(units),
        totalUsd: usdOf(units),
        artistShareUnits: (units - fee).toString(),
        platformFeeUnits: fee.toString(),
      };
    });
    return {
      position,
      trackId: item.trackId,
      title: item.title,
      artistName: item.artistName,
      licenseType: tier,
      rights: {
        licenseType: tier,
        standardTerms: Boolean(grants),
        grants: grants ? [...grants] : [],
      },
      items,
    };
  });

  const budgetUsd = crate.filters.maxTotalUsd ?? null;
  const totalUsd = usdOf(total);
  return {
    id: `quote-${options.number}`,
    crateId: crate.id,
    status: options.status ?? "open",
    chainId: QUOTE_CHAIN_ID,
    marketplaceAddress: QUOTE_MARKETPLACE,
    buyerAddress: body.buyerAddress ?? MOCK_BUYER,
    expiresAt: new Date((options.nowMs ?? Date.now()) + options.expiresInMs).toISOString(),
    transactionHash: options.transactionHash ?? null,
    lines,
    totals:
      total === 0n
        ? []
        : [
            {
              paymentToken: QUOTE_USDC,
              symbol: "USDC",
              decimals: 6,
              totalUnits: total.toString(),
              total: formatUsdc(total),
              totalUsd,
            },
          ],
    totalUsd,
    budgetUsd,
    overBudget: budgetUsd !== null && Number(totalUsd) > budgetUsd,
  };
}

/**
 * A quote that was bought in part, for the receipts a reopened crate shows: the
 * first stem settled, one was left out by the browser, one did not appear in
 * the transaction, and the rest of the lines settled.
 *
 * @param {Record<string, any>} crate
 */
export function settledQuote(crate) {
  const quote = buildQuote(
    crate,
    {
      buyerAddress: MOCK_BUYER,
      lines: crate.items
        .filter((item) => item.available)
        .slice(0, 2)
        .map((item) => ({ trackId: item.trackId, licenseType: "personal", stemTypes: ["drums", "bass"] })),
    },
    { number: 90, expiresInMs: -3_600_000, status: "partial", transactionHash: MOCK_QUOTE_HASH },
  );
  let logIndex = 0;
  const outcomes = ["settled", "dropped", "settled", "failed"];
  quote.lines.forEach((line) => {
    line.items = line.items.map((item) => {
      const outcome = item.status === "quoted" ? (outcomes.shift() ?? "settled") : item.status;
      if (outcome === "settled") {
        logIndex += 1;
        return {
          ...item,
          status: "settled",
          receipt: {
            transactionHash: MOCK_QUOTE_HASH,
            logIndex,
            totalPaidUnits: item.totalUnits,
            purchaseId: `purchase-${logIndex}`,
          },
        };
      }
      if (outcome === "dropped") return { ...item, status: "dropped", reason: "listing_changed" };
      if (outcome === "failed") return { ...item, status: "failed", reason: "not_in_transaction" };
      return item;
    });
  });
  const settledUnits = quote.lines
    .flatMap((line) => line.items)
    .filter((item) => item.status === "settled")
    .reduce((sum, item) => sum + BigInt(item.totalUnits), 0n);
  quote.totals = settledUnits === 0n
    ? []
    : [
        {
          paymentToken: QUOTE_USDC,
          symbol: "USDC",
          decimals: 6,
          totalUnits: settledUnits.toString(),
          total: formatUsdc(settledUnits),
          totalUsd: usdOf(settledUnits),
        },
      ];
  quote.totalUsd = usdOf(settledUnits);
  quote.overBudget = false;
  return quote;
}

/* ------------------------------------------------------------------ */
/* Export to rekordbox or Serato (#1965)                               */
/* ------------------------------------------------------------------ */

/** The stems the mock wallet owns, by track: what a crate export lists. */
const OWNED_STEMS = {
  "track-neon-drift": [
    { stemType: "vocals", licenseType: "remix", bpm: 122, key: "Am", camelot: "8A", firstBeatSec: 0.214 },
    { stemType: "drums", licenseType: "personal", bpm: 122, key: "Am", camelot: "8A", firstBeatSec: 0.214 },
  ],
  "track-glass-harbour": [
    { stemType: "bass", licenseType: "commercial", bpm: 124, key: null, camelot: null, firstBeatSec: null },
  ],
};
/** A track whose only purchases are sync, sample or broadcast licenses. */
const NO_EXPORT_RIGHT_TRACKS = new Set(["track-midnight-courier"]);

const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The backend's export manifest for a mock crate: owned standard-license stems
 * in crate order with their download names, and every other line skipped.
 *
 * @param {Record<string, any>} crate
 * @param {{ owned?: boolean }} [options] `owned: false` owns nothing
 */
export function buildExportManifest(crate, options = {}) {
  const owned = options.owned !== false;
  const entries = [];
  const skipped = [];
  for (const item of crate.items) {
    const stems = owned ? OWNED_STEMS[item.trackId] ?? [] : [];
    for (const stem of stems) {
      entries.push({
        position: item.position,
        trackId: item.trackId,
        stemId: `stem-${item.trackId}-${stem.stemType}`,
        stemType: stem.stemType,
        title: item.title,
        artistName: item.artistName,
        licenseType: stem.licenseType,
        fileName: `${item.artistName} - ${item.title} (${titleCase(stem.stemType)}).mp3`,
        bpm: stem.bpm,
        key: stem.key,
        camelot: stem.camelot,
        firstBeatSec: stem.firstBeatSec,
        hasCue: stem.bpm !== null && stem.firstBeatSec !== null,
      });
    }
    if (stems.length === 0) {
      skipped.push({
        position: item.position,
        trackId: item.trackId,
        title: item.title,
        reason: owned && NO_EXPORT_RIGHT_TRACKS.has(item.trackId) ? "no_export_right" : "not_purchased",
      });
    }
  }
  return {
    entries,
    skipped,
    notes: [
      "Only stems you own under a personal, remix or commercial license are exported. Exporting never grants a license.",
      "The Serato crate lists the files only: Serato reads tempo, key and cues from its own analysis or the file's tags, so the crate carries none of them.",
      ...(entries.some((entry) => entry.bpm === null)
        ? ["1 stem has no measured tempo; your DJ software will analyze it on import."]
        : []),
    ],
  };
}

/**
 * Routes every Crate Digger request to in-memory crates. Anything else the
 * app shell asks the API for is answered with an empty success so the page
 * renders cleanly. Returns the bodies the pages sent, for assertions.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ savedCrates?: Array<Record<string, any>>; latestQuotes?: Record<string, Record<string, any>>; now?: number; ownsNothing?: boolean }} [options] `now` pins the clock quotes expire against (the help screenshots freeze the page's clock to the same instant); `ownsNothing` makes the export manifest empty
 */
export async function mockCrateApi(page, options = {}) {
  /** @type {Map<string, Record<string, any>>} */
  const crates = new Map();
  for (const saved of options.savedCrates ?? []) crates.set(saved.id, saved);
  /** @type {Map<string, Record<string, any>>} */
  const latestQuotes = new Map(Object.entries(options.latestQuotes ?? {}));
  /** @type {Array<{ crateId: string; body: Record<string, any> }>} */
  const quoteRequests = [];
  /** Milliseconds from now each next quote expires in; the last entry repeats. */
  const expiries = [10 * 60_000];
  let quoteNumber = 0;
  /** @type {Array<Record<string, any>>} */
  const created = [];
  /** @type {Array<{ crateId: string; body: Record<string, any> }>} */
  const patches = [];
  /** @type {Array<{ crateId: string; trackId: string }>} */
  const swaps = [];
  let swapped = false;
  let nextId = 1;
  /** @type {Array<{ crateId: string; format: string | null; folder: string | null; urlHasQuery: boolean }>} */
  const exportRequests = [];
  /** @type {Array<{ stemId: string; walletAddress: string }>} */
  const stemDownloads = [];
  /** @type {{ status: number; json: Record<string, any> } | null} */
  let exportFailure = null;

  // Registered first so the specific routes below win (Playwright tries the
  // most recently registered route first).
  await page.route((url) => url.origin === API_ORIGIN, (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") return route.fallback();
    return route.fulfill({ json: [] });
  });
  // The shell's notification bell reads these.
  await page.route(apiPath(/^\/management\/invitations\/pending$/), (route) =>
    route.fulfill({ json: { grants: [], transfers: [] } }),
  );
  // Transition previews fetch each line's original stem: short generated tones.
  await page.route("**/catalog/stems/*/preview", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: toneWav(220, 20) }),
  );
  await page.route("**/analytics/product/event", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );

  await page.route(apiPath(/^\/crates\/requests$/), async (route) => {
    const body = route.request().postDataJSON();
    created.push(body);
    const fromReference = typeof body.referenceTrackId === "string";
    const id = fromReference ? REFERENCE_CRATE_ID : created.length === 1 ? CRATE_ID : `${CRATE_ID}-${nextId++}`;
    const crate = fromReference
      ? mockCrate(id, {
          filters: { ...defaultFilters(), bpm: null, keys: [], requiredStems: [], maxPerItemUsd: null },
        })
      : mockCrate(id);
    crates.set(id, crate);
    await route.fulfill({
      status: 201,
      json: {
        crate,
        request: {
          id: `request-${created.length}`,
          source: fromReference ? "reference_track" : "text",
          parserStrategy: "deterministic",
          unparsed: fromReference ? [] : ["melodic house"],
        },
        coverage: {
          requested: 8,
          found: 6,
          gaps: [
            { filter: "keys", wouldAdd: 2 },
            { filter: "maxPerItemUsd", wouldAdd: 1 },
          ],
        },
      },
    });
  });

  await page.route(apiPath(/^\/crates$/), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const list = [...crates.values()].map((crate) => ({
      id: crate.id,
      title: crate.title,
      status: crate.status,
      itemCount: crate.items.length,
      createdAt: crate.createdAt,
      updatedAt: crate.updatedAt,
    }));
    await route.fulfill({ json: { crates: list } });
  });

  await page.route(apiPath(/^\/crates\/[^/]+\/items\/[^/]+\/swap$/), async (route) => {
    const match = /\/crates\/([^/]+)\/items\/([^/]+)\/swap$/.exec(new URL(route.request().url()).pathname);
    const crateId = decodeURIComponent(match?.[1] ?? "");
    const trackId = decodeURIComponent(match?.[2] ?? "");
    swaps.push({ crateId, trackId });
    const crate = crates.get(crateId);
    if (!crate) return route.fulfill({ status: 404, json: { message: "Crate not found" } });
    const target = crate.items.find((item) => item.trackId === trackId);
    if (target?.locked) {
      return route.fulfill({
        status: 409,
        json: { code: "line_locked", message: "That line is locked" },
      });
    }
    if (swapped || !target) {
      return route.fulfill({ json: { crate, swapped: false } });
    }
    swapped = true;
    const items = crate.items.map((item) =>
      item.trackId === trackId ? { ...spareLine(), locked: false } : item,
    );
    const next = { ...mockCrate(crateId, { items }), ...pick(crate, ["title", "status", "filters", "createdAt"]) };
    crates.set(crateId, next);
    await route.fulfill({ json: { crate: next, swapped: true } });
  });

  await page.route(apiPath(/^\/crates\/[^/]+\/quote$/), async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const crateId = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2] ?? "");
    const crate = crates.get(crateId);
    if (!crate) return route.fulfill({ status: 404, json: { message: "Crate not found" } });
    const body = route.request().postDataJSON();
    quoteRequests.push({ crateId, body });
    quoteNumber += 1;
    const expiresInMs = expiries.length > 1 ? (expiries.shift() ?? 0) : expiries[0];
    const quote = buildQuote(crate, body, { number: quoteNumber, expiresInMs, nowMs: options.now });
    latestQuotes.set(crateId, quote);
    await route.fulfill({ status: 201, json: quote });
  });

  // The licensed stem download, through the app's own origin (a rewrite to the API).
  await page.route("**/api/encryption/download", async (route) => {
    const body = route.request().postDataJSON();
    stemDownloads.push({ stemId: body.stemId, walletAddress: body.walletAddress });
    await route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: Buffer.from(`mp3:${body.stemId}`),
    });
  });

  await page.route(apiPath(/^\/crates\/[^/]+\/export\/manifest$/), async (route) => {
    const crateId = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2] ?? "");
    const crate = crates.get(crateId);
    if (!crate) return route.fulfill({ status: 404, json: { message: "Crate not found" } });
    await route.fulfill({ json: buildExportManifest(crate, { owned: !options.ownsNothing }) });
  });

  await page.route(apiPath(/^\/crates\/[^/]+\/export$/), async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const url = new URL(route.request().url());
    const crateId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
    // The folder travels in the body, never in the URL.
    const body = route.request().postDataJSON() ?? {};
    const format = typeof body.format === "string" ? body.format : null;
    exportRequests.push({
      crateId,
      format,
      folder: typeof body.folder === "string" ? body.folder : null,
      urlHasQuery: url.search !== "",
    });
    if (exportFailure) return route.fulfill(exportFailure);
    const crate = crates.get(crateId);
    if (!crate) return route.fulfill({ status: 404, json: { message: "Crate not found" } });
    const title = crate.title || "Resonate crate";
    const fileName = `${title}.${format === "serato" ? "crate" : "xml"}`;
    await route.fulfill({
      status: 200,
      contentType: format === "serato" ? "application/octet-stream" : "application/xml; charset=utf-8",
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Access-Control-Expose-Headers": "Content-Disposition",
      },
      body: format === "serato" ? Buffer.from("vrsn") : `<DJ_PLAYLISTS Version="1.0.0"/>`,
    });
  });

  await page.route(apiPath(/^\/crates\/(?!requests$)[^/]+$/), async (route) => {
    const request = route.request();
    const crateId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
    const crate = crates.get(crateId);
    if (!crate) {
      return route.fulfill({ status: 404, json: { message: "Crate not found" } });
    }
    if (request.method() === "PATCH") {
      /** @type {{ title?: string | null; status?: string; items?: Array<{ trackId: string; locked?: boolean }> }} */
      const body = request.postDataJSON();
      patches.push({ crateId, body });
      let items = crate.items;
      if (body.items) {
        items = body.items.map((entry) => {
          const existing = crate.items.find((item) => item.trackId === entry.trackId);
          return { ...existing, locked: entry.locked ?? existing?.locked ?? false };
        });
      }
      const next = {
        ...mockCrate(crateId, { items }),
        ...pick(crate, ["filters", "createdAt"]),
        title: body.title === undefined ? crate.title : body.title,
        status: body.status ?? crate.status,
        updatedAt: "2026-09-28T09:30:00.000Z",
      };
      crates.set(crateId, next);
      return route.fulfill({ json: { crate: next } });
    }
    if (request.method() === "GET") {
      return route.fulfill({ json: { crate, latestQuote: latestQuotes.get(crateId) ?? null } });
    }
    return route.fallback();
  });

  return {
    patches,
    swaps,
    created,
    crates,
    quoteRequests,
    /** Every export request: the crate, the format and the folder the page sent in the body. */
    exportRequests,
    /** Every stem download: the stem and the wallet address the page sent. */
    stemDownloads,
    /** The next export request fails with this response (null: succeed). */
    failExport: (/** @type {{ status: number; json: Record<string, any> } | null} */ failure) => {
      exportFailure = failure;
    },
    /** The next quote expires in this many milliseconds (negative: already expired). */
    expireNextQuoteIn: (/** @type {number} */ ms) => {
      expiries.length = 0;
      expiries.push(ms, 10 * 60_000);
    },
  };
}

/**
 * @param {Record<string, any>} source
 * @param {string[]} keys
 */
function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}
