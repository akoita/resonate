/**
 * A fully mocked Crate Digger API (#1963), shared by the Playwright flow in
 * `tests/crate-digger.spec.ts` and the User Guide screenshot capture
 * (`scripts/capture-help-screenshots.mjs`), so the guide's images and the
 * tested pages can't drift apart. No backend data is needed.
 *
 * The shapes mirror `backend/src/modules/crates/crate.dto.ts`. The mock is
 * stateful enough for the editing flow: PATCH applies the title, status,
 * order, locks and removals, and swap replaces a line with a spare track.
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

/**
 * Routes every Crate Digger request to in-memory crates. Anything else the
 * app shell asks the API for is answered with an empty success so the page
 * renders cleanly. Returns the bodies the pages sent, for assertions.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ savedCrates?: Array<Record<string, any>> }} [options]
 */
export async function mockCrateApi(page, options = {}) {
  /** @type {Map<string, Record<string, any>>} */
  const crates = new Map();
  for (const saved of options.savedCrates ?? []) crates.set(saved.id, saved);
  /** @type {Array<Record<string, any>>} */
  const created = [];
  /** @type {Array<{ crateId: string; body: Record<string, any> }>} */
  const patches = [];
  /** @type {Array<{ crateId: string; trackId: string }>} */
  const swaps = [];
  let swapped = false;
  let nextId = 1;

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
      return route.fulfill({ json: { crate } });
    }
    return route.fallback();
  });

  return { patches, swaps, created, crates };
}

/**
 * @param {Record<string, any>} source
 * @param {string[]} keys
 */
function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}
