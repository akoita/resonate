/**
 * Capture the User Guide screenshots from a running Resonate instance.
 *
 * The in-app guide (`/help`) illustrates features with real screenshots.
 * Three passes:
 *   - PUBLIC pass: no-login surfaces (Discover, Catalog, Shows, Marketplace,
 *     Player, Wallet, and the connect wall). Best captured against staging.
 *   - SIGNED-IN pass: pages behind the connect wall (Upload, Create, Settings,
 *     AI DJ, Sonic Radar, Library, Disputes). These can't be reached publicly,
 *     so we inject the same mock-auth localStorage the E2E tests use
 *     (web/tests/auth.setup.ts) to render the signed-in shells. Run this pass
 *     against a LOCAL instance (BASE_URL=http://localhost:3001) for clean,
 *     stable previews.
 *   - SEEDED OWNER pass: data-heavy owner views (Artist Analytics, Managed
 *     Catalog, and Community) against a seeded local backend. This pass logs
 *     in through the local development endpoint and never enables mock auth.
 *   - REMIX STUDIO pass (#1905, opt-in): the Remix Studio guide images from a
 *     fully mocked studio — the same mock the Playwright studio flows use
 *     (web/tests/fixtures/remix-studio-mock.mjs), so no backend or staging
 *     data is needed and every run draws the same pictures. The overview is
 *     annotated with numbered callouts drawn into the image.
 *   - CRATE DIGGER pass (#1963, opt-in): the Crate Digger guide images from a
 *     fully mocked crate API (web/tests/fixtures/crate-digger-mock.mjs, shared
 *     with the Playwright flow), so no backend or catalog data is needed.
 *
 * Usage:
 *   # Public pass against staging (default):
 *   node scripts/capture-help-screenshots.mjs
 *
 *   # Both passes against a local instance:
 *   BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
 *
 *   # Refresh one screenshot only:
 *   CAPTURE_ONLY=player.png BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
 *
 *   # Skip the signed-in pass:
 *   CAPTURE_AUTH=false node scripts/capture-help-screenshots.mjs
 *
 *   # Seeded owner pass (run `npx prisma db seed` in the backend first):
 *   CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_OWNER=true \
 *     BASE_URL=http://localhost:3001 API_BASE_URL=http://localhost:3000 \
 *     node scripts/capture-help-screenshots.mjs
 *
 *   # Remix Studio pass (a local dev server with mock auth is enough):
 *   CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_REMIX=true \
 *     BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
 *
 *   # Crate Digger pass (a local dev server with mock auth is enough):
 *   CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_CRATES=true \
 *     BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
 *
 * Requirements: a Chromium browser for Playwright
 *   npx playwright install chromium
 *   (or set CHROMIUM_EXECUTABLE_PATH to an installed Chromium binary)
 *
 * Output: web/public/help/screenshots/*.png (1440x900 viewport, 1x; selected
 * data-heavy pages use a taller viewport so all documented panels appear, and
 * a target may run a `prepare` step — e.g. Discover skips QA campaigns).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PROJECT_ID as REMIX_PROJECT_ID, mockRemixApi } from "../tests/fixtures/remix-studio-mock.mjs";
import {
  CRATE_ID,
  CRATE_REQUEST_TEXT,
  mockCrate,
  mockCrateApi,
} from "../tests/fixtures/crate-digger-mock.mjs";

const BASE_URL = process.env.BASE_URL ?? "https://staging.resonate.pydes.xyz";
const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CAPTURE_PUBLIC = process.env.CAPTURE_PUBLIC !== "false";
const CAPTURE_AUTH = process.env.CAPTURE_AUTH !== "false";
const CAPTURE_OWNER = process.env.CAPTURE_OWNER === "true";
const CAPTURE_REMIX = process.env.CAPTURE_REMIX === "true";
const CAPTURE_CRATES = process.env.CAPTURE_CRATES === "true";
const OWNER_USER_ID = "e2e-user-00000000-0000-0000-0000-000000000001";
const OWNER_WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/help/screenshots",
);

// route -> output filename. Keep in sync with figure `src` values in
// web/src/lib/help/content.ts.
const PUBLIC_TARGETS = [
  [
    "/",
    "discover-home.png",
    {
      selectors: [".ng-hero__campaign-rail", ".ng-tuner"],
      text: ["Recently Added"],
      viewportHeight: 1200,
      reducedMotion: true,
      prepare: featureRealCampaign,
    },
  ],
  ["/catalog", "catalog.png"],
  ["/shows", "shows.png"],
  ["/shows/sennarin-paris", "show-campaign.png"],
  ["/marketplace", "marketplace.png"],
  ["/drops", "drops.png"],
  ["/player", "player.png"],
  ["/wallet", "wallet.png"],
  ["/library", "connect-wallet.png"],
];

const AUTH_TARGETS = [
  ["/artist/upload", "upload.png"],
  ["/create", "create.png"],
  ["/settings", "settings.png", {
    // #2006: the Taste Memory section with the "Tell us what you want more or
    // less of" box and a previewed edit, drawn from a fixed taste memory so the
    // picture does not need a backend.
    mockTasteMemory: true,
    viewportHeight: 1800,
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.locator(".settings-nav button").filter({ hasText: "Taste Memory" }).first().click();
      await page.getByLabel("Your words").fill("Less drill, more jazz, something calmer, and no more Night Courier");
      await page.getByRole("button", { name: "Preview changes" }).click();
      await page.getByRole("list", { name: "Proposed taste changes" }).waitFor({ state: "visible" });
      await page.evaluate(() => document.activeElement?.blur());
      await page.getByRole("heading", { name: "Tell us what you want more or less of" }).scrollIntoViewIfNeeded();
    },
  }],
  ["/agent", "ai-dj.png", { prepare: async (page) => { await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); } }],
  ["/sonic-radar", "sonic-radar.png", {
    // ADR-TE-5: the discovery journal, drawn from a fixed sample journal.
    mockDiscoveries: true,
    prepare: async (page) => { await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); },
  }],
  ["/library", "library.png", {
    mockLibrary: true,
    selectors: [".library-item:not(.library-item-header)"],
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.locator(".library-item:not(.library-item-header) .track-action-menu-trigger").first().click();
      await page.getByRole("button", { name: "Remove from library" }).waitFor({ state: "visible" });
    },
  }],
  ["/disputes", "disputes.png"],
  ["/artist/management", "artist-management.png", {
    selectors: ["section[aria-labelledby='owned-heading']"],
    viewportHeight: 1900,
    mockManagement: true,
    selectManagementRelease: true,
    prepare: async (page) => {
      await page.locator("section[aria-labelledby='owned-heading']").evaluate((element) => element.scrollIntoView({ block: "start" }));
    },
  }],
  ["/artist/management", "artist-claim-request.png", {
    selectors: ["section[aria-labelledby='artist-claim-center-heading']"],
    viewportHeight: 1100,
    mockManagement: true,
    mockClaim: true,
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.getByLabel("Find a credited profile").fill("Aya Lune");
      await page.getByRole("list", { name: "Matching artist profiles" }).getByRole("button").first().click();
      await page.getByText("First Light", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Continue to evidence" }).click();
    },
  }],
  ["/artist/guide-enrichment-artist", "artist-enrichment.png", {
    selectors: [".artist-edit-profile-btn"],
    viewportHeight: 1200,
    mockEnrichment: true,
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.getByRole("button", { name: "Edit profile" }).click();
      await page.getByRole("button", { name: "Find suggestions" }).click();
      await page.getByRole("radio").first().check();
      await page.getByRole("button", { name: "Review suggestions" }).click();
      await page.getByRole("checkbox", { name: /Bio/ }).check();
      await page.locator(".artist-enrichment").scrollIntoViewIfNeeded();
    },
  }],
  ["/artist/management", "artist-management-invitation.png", {
    selectors: ["section[aria-labelledby='owned-heading']"],
    mockManagement: true,
    mockInvitation: true,
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.getByRole("button", { name: "Notifications" }).click();
      await page.getByText("Management invitation", { exact: true }).waitFor();
    },
  }],
  ["/artist/management", "artist-management-recovery.png", {
    selectors: ["section[aria-labelledby='accepted-transfers-heading']"],
    viewportHeight: 1050,
    mockManagement: true,
    mockRecovery: true,
    prepare: async (page) => {
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.getByRole("heading", { name: "Accepted management transfers" }).scrollIntoViewIfNeeded();
    },
  }],
];

const OWNER_TARGETS = [
  [
    "/artist/analytics",
    "artist-analytics.png",
    {
      selectors: ["section[aria-label=\"Artist analytics summary\"]"],
      text: ["Plays over time", "Track Performance"],
    },
  ],
  [
    "/artist/catalog",
    "artist-catalog.png",
    {
      selectors: ["section[aria-label=\"Managed catalog summary\"]"],
      text: ["Releases", "Tracks"],
    },
  ],
  [
    "/community",
    "community.png",
    {
      selectors: [".community-benefits__privacy", ".listener-cohort-list"],
      text: ["Benefits for your listener account", "Listener Cohorts"],
      viewportHeight: 1200,
    },
  ],
];

// Mock auth identical to web/tests/auth.setup.ts — a non-cryptographic JWT the
// frontend accepts (role: artist). Activates the client mock-auth path via the
// `resonate.mock_auth` localStorage flag, so no rebuild/env change is needed.
const MOCK_AUTH = {
  address: "0x742d35cc6634c0532925a3b844bc9e7595f1ea2c",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiYXJ0aXN0IiwiYWRkcmVzcyI6IjB4NzQyZDM1Y2M2NjM0YzA1MzI5MjVhM2I4NDRiYzllNzU5NWYxZWEyYyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDAwfQ.mock-signature",
};

// Staging carries QA campaigns ("TEST #1666 — …") that can outrank real ones in
// the home hero. Feature the first campaign that doesn't look like test data so
// the guide never illustrates a throwaway record.
const TEST_DATA_TITLE = /^\s*(test|qa|e2e|tmp|dummy)\b/i;

async function featureRealCampaign(page) {
  const tabs = page.locator(".ng-hero__campaign-tab");
  const count = await tabs.count();
  for (let i = 0; i < count; i += 1) {
    const tab = tabs.nth(i);
    const title = await tab.locator(".ng-hero__campaign-copy strong").first().innerText();
    if (TEST_DATA_TITLE.test(title)) continue;
    await tab.click();
    // Drop focus so no focus ring lands in the shot; reduced motion keeps the
    // hero from rotating away from the selection.
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    return;
  }
  console.warn("! /: every featured campaign looks like test data; keeping the default hero");
}

async function waitForRouteReady(page, route, ready) {
  if (!ready) return;

  try {
    for (const selector of ready.selectors ?? []) {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: 45000 });
    }
    for (const text of ready.text ?? []) {
      await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 45000 });
    }
  } catch (err) {
    console.warn(`! ${route}: ready state not observed (${String(err).slice(0, 120)})`);
  }
}

async function capture(page, targets, passName) {
  for (const [route, file, ready] of targets) {
    if (process.env.CAPTURE_ONLY && file !== process.env.CAPTURE_ONLY) continue;
    if (ready?.mockLibrary) {
      const createdAt = "2026-09-01T12:00:00.000Z";
      await page.route("**/library/tracks", (request) => request.fulfill({
        json: [
          { id: "guide-song-1", userId: "guide-listener", source: "remote", title: "Golden Hour", artist: "Felicia Angels", albumArtist: "Felicia Angels", album: "First Light", duration: 213, remoteArtworkUrl: "/shows/felicia-angels-cover.webp", createdAt },
          { id: "guide-song-2", userId: "guide-listener", source: "remote", title: "After the Rain", artist: "Felicia Angels", albumArtist: "Felicia Angels", album: "First Light", duration: 189, remoteArtworkUrl: "/shows/felicia-angels-cover.webp", createdAt },
        ],
      }));
    }
    if (ready?.mockTasteMemory) {
      const createdAt = "2026-09-20T09:00:00.000Z";
      await page.route("**/recommendations/taste-memory", (request) => request.fulfill({
        json: {
          schemaVersion: "listener-taste-memory/v1",
          settings: {
            socialMatchingEnabled: false,
            citySceneDiscoveryEnabled: false,
            agentPlaybackTrainingEnabled: true,
            recommendationExplanationPreference: "balanced",
            resetAt: null,
          },
          summary: {
            favoredGenres: ["Amapiano", "Soul"],
            favoredMoods: ["Warm"],
            favoredArtists: ["Felicia Angels"],
            recentIntents: [],
            noveltyPattern: "Likes a mix of familiar and new",
            commercePreference: "Not enough signal yet",
            explanationPreference: "balanced",
          },
          controls: [
            { id: "guide-control-1", signalType: "genre", value: "Jazz", action: "boosted", source: "declared_text_edit", createdAt },
            { id: "guide-control-2", signalType: "mood", value: "Dark", action: "downranked", source: null, createdAt },
          ],
          privacy: {
            socialMatching: "disabled",
            citySceneDiscovery: "disabled",
            agentPlaybackTraining: "enabled",
            notes: [],
          },
        },
      }));
      await page.route("**/recommendations/taste-memory/edits/preview", (request) => request.fulfill({
        json: {
          items: [
            { id: "edit-1", kind: "downrank_genre", signalType: "genre", value: "Drill", action: "downranked", phrase: "Less drill", statement: "Show less Drill" },
            { id: "edit-2", kind: "boost_genre", signalType: "genre", value: "Jazz", action: "boosted", phrase: "more jazz", statement: "Show more Jazz" },
            { id: "edit-3", kind: "energy_preference", signalType: "energy", value: "low", action: "boosted", phrase: "something calmer", statement: "Prefer calmer, lower-energy music" },
            { id: "edit-4", kind: "unmapped", signalType: null, value: "", action: null, phrase: "no more Night Courier", statement: "Couldn't map 'no more Night Courier' to a taste signal" },
          ],
        },
      }));
    }
    if (ready?.mockDiscoveries) {
      const item = (trackId, title, artistName, extra) => ({
        trackId, title, artistId: `guide-artist-${artistName.toLowerCase().replace(/\s+/g, "-")}`, artistName,
        releaseId: "guide-release", releaseTitle: "First Light", artworkUrl: "/shows/felicia-angels-cover.webp",
        hasUploadedArtwork: false, artworkRevision: null, resonatedAt: "2026-09-29T19:40:00.000Z",
        followUp: "saved", discovery: false,
        reason: { code: "learned_taste", text: "Boosted by learned taste" }, nextAction: null, ...extra,
      });
      await page.route("**/agents/discoveries**", (request) => request.fulfill({
        json: {
          schemaVersion: "discovery-journal/v1",
          window: { days: 28, from: "2026-09-02T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" },
          headline: { resonantDiscoveriesThisWeek: 2, newArtistsThisWeek: 2 },
          groups: [
            { key: "day:2026-09-29", sessionId: null, date: "2026-09-29", items: [
              item("guide-song-1", "Golden Hour", "Felicia Angels", {
                discovery: true, followUp: "replayed",
                reason: { code: "discovery_pick", text: "Discovery pick: new verified artist close to your taste" },
                nextAction: { kind: "show_campaign", label: "Back the Paris show", href: "/shows/felicia-angels-paris" },
              }),
              item("guide-song-2", "After the Rain", "Felicia Angels"),
            ] },
            { key: "day:2026-09-27", sessionId: null, date: "2026-09-27", items: [
              item("guide-song-3", "Night Signals", "Sennarin", {
                discovery: true, resonatedAt: "2026-09-27T21:10:00.000Z",
                reason: { code: "discovery_pick", text: "Discovery pick: new verified artist close to your taste" },
                nextAction: { kind: "artist_page", label: "Visit the artist", href: "/artist/guide-artist-sennarin" },
              }),
            ] },
          ],
        },
      }));
    }
    if (ready?.mockManagement) {
      await page.route("**/artists/claims/me", (request) => request.fulfill({ json: [] }));
      if (ready.mockClaim) {
        await page.route("**/artists/search?**", (request) => request.fulfill({ json: [
          { id: "79b28c7b-79d3-4d83-9c76-8332a0316e0a", displayName: "Aya Lune", profileType: "public_artist", claimStatus: "unclaimed" },
        ] }));
        await page.route("**/catalog/artist/79b28c7b-79d3-4d83-9c76-8332a0316e0a", (request) => request.fulfill({ json: [
          { id: "guide-first-light", artistId: "79b28c7b-79d3-4d83-9c76-8332a0316e0a", title: "First Light", type: "EP", status: "ready", releaseDate: "2026-09-01T00:00:00.000Z", explicit: false, createdAt: "2026-09-01T00:00:00.000Z", tracks: [] },
        ] }));
      }
      await page.route("**/management/me", (request) => request.fulfill({
        json: {
          ownedArtists: ready.mockInvitation || ready.mockRecovery ? [] : [{ id: "guide-artist", name: "Test Artist" }],
          managedArtists: [],
          ownedReleases: ready.mockInvitation || ready.mockRecovery ? [] : [{ id: "guide-release", title: "Test Release", artistId: "guide-artist" }],
          managedReleases: [],
          pendingGrants: ready.mockInvitation ? [{
            id: "guide-invitation",
            artistId: "guide-artist",
            releaseId: null,
            resourceName: "Test Artist",
            scopes: ["PROFILE_EDIT"],
            status: "pending",
            expiresAt: null,
          }] : [],
          pendingTransfers: [],
          outgoingTransfers: [],
        },
      }));
      await page.route("**/management/releases/guide-release/access", (request) => request.fulfill({
        json: {
          resourceType: "release",
          resourceId: "guide-release",
          currentUserAccess: { isOwner: true, scopes: ["CATALOG_READ", "CATALOG_METADATA", "CATALOG_MEDIA"] },
          grants: [{
            id: "guide-grant",
            granteeEmail: "manager@example.com",
            scopes: ["CATALOG_READ", "CATALOG_METADATA"],
            status: "active",
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          }],
        },
      }));
      await page.route("**/management/recoveries/me", (request) => request.fulfill({
        json: {
          transfers: ready.mockRecovery ? [{
            id: "guide-accepted-transfer",
            resourceType: "release",
            resourceIds: ["guide-release"],
            resources: [{ id: "guide-release", name: "Test Release" }],
            acceptedAt: "2026-09-01T12:00:00.000Z",
            eligible: true,
            recovery: null,
          }] : [],
        },
      }));
    }
    if (ready?.mockEnrichment) {
      const id = "guide-enrichment-artist";
      await page.route(`**/artists/${id}`, (request) => request.fulfill({ json: {
        id, displayName: "Felicia Angels", profileType: "public_artist",
        imageUrl: null, summary: null, website: null, socialLinks: null,
      } }));
      await page.route(`**/management/artists/${id}/access`, (request) => request.fulfill({ json: {
        resourceType: "artist_profile", resourceId: id,
        currentUserAccess: { isOwner: true, scopes: ["PROFILE_EDIT"] }, grants: [],
      } }));
      await page.route(`**/catalog/artist/${id}`, (request) => request.fulfill({ json: [] }));
      await page.route(`**/artists/${id}/enrichment/candidates`, (request) => request.fulfill({ json: [
        { id: "f3be8e9e-542a-4e4c-a5b3-ea2d58123e71", name: "Felicia Angels", area: "United States", type: "Person", score: 97, sourceUrl: "https://musicbrainz.org/artist/f3be8e9e-542a-4e4c-a5b3-ea2d58123e71" },
        { id: "6226dc04-b38c-451a-86a8-8d5abddba733", name: "Felicia Angels", disambiguation: "producer", area: "Canada", type: "Person", score: 72, sourceUrl: "https://musicbrainz.org/artist/6226dc04-b38c-451a-86a8-8d5abddba733" },
      ] }));
      await page.route(`**/artists/${id}/enrichment/suggestions`, (request) => request.fulfill({ json: {
        candidate: { id: "f3be8e9e-542a-4e4c-a5b3-ea2d58123e71", name: "Felicia Angels", area: "United States", type: "Person", sourceUrl: "https://musicbrainz.org/artist/f3be8e9e-542a-4e4c-a5b3-ea2d58123e71" },
        suggestions: [
          { field: "summary", value: "Felicia Angels is an independent singer and songwriter.", sourceUrl: "https://www.wikidata.org/wiki/Q123", sourceLabel: "Wikidata", confidence: "medium" },
          { field: "website", value: "https://feliciaangels.example", sourceUrl: "https://musicbrainz.org/artist/f3be8e9e-542a-4e4c-a5b3-ea2d58123e71", sourceLabel: "MusicBrainz", confidence: "medium" },
        ],
        warnings: [],
      } }));
    }
    if (ready?.mockInvitation) {
      await page.route("**/management/invitations/pending", (request) => request.fulfill({
        json: {
          grants: [{
            id: "guide-invitation",
            artistId: "guide-artist",
            releaseId: null,
            resourceName: "Test Artist",
            scopes: ["PROFILE_EDIT"],
            expiresAt: null,
          }],
          transfers: [],
        },
      }));
    }
    // Reset per target so one tall capture doesn't leak into the next.
    await page.setViewportSize({ width: 1440, height: ready?.viewportHeight ?? 900 });
    await page.emulateMedia({ reducedMotion: ready?.reducedMotion ? "reduce" : "no-preference" });
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch (err) {
      console.warn(`! ${route}: ${String(err).slice(0, 80)}`);
    }
    await waitForRouteReady(page, route, ready);
    if (ready?.selectManagementRelease) {
      await page.getByLabel("Choose a resource").selectOption("release:guide-release");
      await page.getByText("Transfer management").waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Edit access" }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    if (ready?.prepare) await ready.prepare(page);
    // Let fonts, artwork, and async client data settle before the shot.
    await page.waitForTimeout(3200);
    await page.screenshot({ path: path.join(OUT_DIR, file) });
    console.log(`✓ [${passName}] ${route} -> public/help/screenshots/${file}`);
  }
}

async function loginSeededOwner(page) {
  const response = await page.request.post(`${API_BASE_URL}/auth/login`, {
    data: { userId: OWNER_USER_ID, role: "artist" },
  });
  if (!response.ok()) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Seeded owner login failed (${response.status()}): ${detail.slice(0, 240) || response.statusText()}`,
    );
  }

  const body = await response.json();
  if (!body || typeof body.accessToken !== "string" || body.accessToken.length === 0) {
    throw new Error("Seeded owner login returned no accessToken");
  }
  return { token: body.accessToken, address: OWNER_WALLET_ADDRESS };
}


// ── Remix Studio pass (#1905) ────────────────────────────────────────────
// A project with a rendered draft and one earlier version, for the overview
// and the Drafts panel. Fixed dates older than a day render as absolute
// times, and the pass pins locale and time zone, so the text never drifts.
const REMIX_WITH_DRAFTS = {
  generationJobId: "job-current",
  generationProvider: "stem-mix-render",
  generationMetadata: {
    status: "completed",
    grounding: "stem_audio",
    estimatedCostUsd: 0,
    completedAt: "2026-09-20T13:36:00.000Z",
    output: { outputUri: "/storage/remix-drafts/job-current.mp3" },
    previousDrafts: [
      {
        jobId: "job-older",
        provider: "stem-mix-render",
        grounding: "stem_audio",
        estimatedCostUsd: 0,
        completedAt: "2026-09-19T10:00:00.000Z",
        outputUri: "/storage/remix-drafts/job-older.mp3",
      },
    ],
  },
};

/** Numbered callouts for the overview; keep in sync with the guide's legend. */
const REMIX_OVERVIEW_CALLOUTS = [
  { selector: ".remix-session", label: "Session" },
  { selector: ".remix-transport-bar", label: "Transport" },
  { selector: ".remix-studio-create-column", label: "Create" },
  { selector: "section[aria-label='Drafts']", label: "Drafts" },
];

/** Draws numbered outlines + labels over elements, in document coordinates. */
async function drawCallouts(page, callouts) {
  await page.evaluate((marks) => {
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none";
    document.body.appendChild(layer);
    marks.forEach(({ selector, label }, index) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`callout target missing: ${selector}`);
      const r = element.getBoundingClientRect();
      const x = r.left + window.scrollX;
      const y = r.top + window.scrollY;
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${x - 4}px;top:${y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid #facc15;border-radius:16px;box-sizing:border-box`;
      const tag = document.createElement("div");
      tag.textContent = `${index + 1}  ${label}`;
      tag.style.cssText = `position:absolute;left:${x - 14}px;top:${y - 18}px;padding:0 12px;height:32px;border-radius:16px;background:#facc15;color:#111;font:800 16px/32px system-ui,sans-serif;white-space:pre;box-shadow:0 2px 10px rgba(0,0,0,.55)`;
      layer.append(box, tag);
    });
  }, callouts);
}

/** A box around several elements plus padding, for page.screenshot's clip. */
async function unionClip(page, locators, pad = 12) {
  const boxes = [];
  for (const locator of locators) boxes.push(await locator.boundingBox());
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

// file -> { viewportHeight, project, prepare(page) => { locator } | { clip } | {} }
const REMIX_TARGETS = [
  {
    file: "remix-studio-overview.png",
    viewportHeight: 1280,
    project: REMIX_WITH_DRAFTS,
    prepare: async (page) => {
      await drawCallouts(page, REMIX_OVERVIEW_CALLOUTS);
      return {};
    },
  },
  {
    file: "remix-studio-sections.png",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Drums: section 2 on" }).click();
      await page.getByRole("button", { name: "Drums: section 2 off" }).waitFor();
      await page.getByText("All changes saved").waitFor();
      return { locator: page.locator(".remix-session") };
    },
  },
  {
    file: "remix-studio-loop.png",
    prepare: async (page) => {
      await page.getByRole("button", { name: /Loop section 3/ }).click();
      await page.getByText("Looping bar 17").waitFor();
      return {
        clip: await unionClip(page, [
          page.locator(".remix-transport-bar"),
          page.getByRole("button", { name: /Loop section 3/ }),
          page.getByRole("button", { name: "Mute Vocals" }),
        ]),
      };
    },
  },
  {
    file: "remix-studio-vibe.png",
    viewportHeight: 1400,
    prepare: async (page) => {
      await page.getByRole("group", { name: "Vibe" }).getByRole("button", { name: "Slowed + reverb" }).click();
      await page.getByText("All changes saved").waitFor();
      return { clip: await unionClip(page, [page.locator(".remix-vibe")]) };
    },
  },
  {
    file: "remix-studio-effects.png",
    prepare: async (page) => {
      await page.getByRole("switch", { name: /^Pro/ }).click();
      await page.getByRole("button", { name: /^Effects for Vocals/ }).click();
      const row = page.getByRole("group", { name: "Vocals effects" });
      await row.getByRole("slider", { name: /Vocals echo/ }).fill("0.35");
      await row.getByRole("slider", { name: "Vocals EQ High 4 kHz" }).fill("2");
      await row.getByRole("slider", { name: "Vocals pan" }).fill("-0.2");
      await page.getByText("All changes saved").waitFor();
      return { locator: page.locator(".remix-session-lanes") };
    },
  },
  {
    file: "remix-studio-drafts.png",
    project: REMIX_WITH_DRAFTS,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Delete version from/ }).waitFor();
      return { locator: page.locator("section[aria-label='Drafts']") };
    },
  },
  {
    file: "remix-studio-ai-part.png",
    viewportHeight: 1200,
    prepare: async (page) => {
      await page.getByRole("group", { name: "What to create" }).getByRole("button", { name: "Add AI" }).click();
      await page.getByRole("radiogroup", { name: "Instrument" }).getByText("Bass", { exact: true }).click();
      await page.getByRole("button", { name: "Generate 3 takes" }).click();
      const tray = page.locator(".remix-parts-tray");
      await tray.locator(".remix-parts-take-ready").nth(2).waitFor({ timeout: 15000 });
      await tray.getByText("3 takes ready.").waitFor();
      await tray.scrollIntoViewIfNeeded();
      return {
        clip: await unionClip(page, [page.getByText("Add a part", { exact: true }), tray]),
      };
    },
  },
];

async function captureRemix(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  });
  await ctx.addInitScript((auth) => {
    localStorage.setItem("resonate.token", auth.token);
    localStorage.setItem("resonate.address", auth.address);
    localStorage.setItem("resonate.mock_auth", "true");
    // Pro mode starts off on every run (the switch is remembered per device).
    localStorage.removeItem("resonate.remixStudio.proMode");
  }, MOCK_AUTH);
  for (const target of REMIX_TARGETS) {
    if (process.env.CAPTURE_ONLY && target.file !== process.env.CAPTURE_ONLY) continue;
    // A fresh page per target: routes and studio state never leak between shots.
    const page = await ctx.newPage();
    await mockRemixApi(page, { project: target.project });
    await page.setViewportSize({ width: 1440, height: target.viewportHeight ?? 1000 });
    await page.goto(`${BASE_URL}/remix/studio/${REMIX_PROJECT_ID}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.getByRole("heading", { name: "Session" }).waitFor({ timeout: 90000 });
    // Waveforms appear once every stem preview is decoded.
    await page.locator(".remix-session-lanes svg path").first().waitFor({ timeout: 45000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const shot = await target.prepare(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(1500);
    const out = path.join(OUT_DIR, target.file);
    if (shot.locator) await shot.locator.screenshot({ path: out });
    else if (shot.clip) await page.screenshot({ path: out, clip: shot.clip });
    else await page.screenshot({ path: out });
    console.log(`✓ [remix] ${target.file}`);
    await page.close();
  }
  await ctx.close();
}

// ── Crate Digger pass (#1963) ────────────────────────────────────────────
// Two earlier crates for the list under the request box. Fixed dates and a
// pinned locale and time zone keep the list text identical on every run.
const CRATE_LIST_SAMPLES = [
  mockCrate("guide-crate-saved", {
    title: "Sunday sunset set",
    status: "saved",
    items: mockCrate("sample").items.slice(0, 5),
  }),
  mockCrate("guide-crate-draft", { items: mockCrate("sample").items.slice(0, 4) }),
];

const CRATE_CLOCK_MS = Date.parse("2026-09-28T09:30:00.000Z");

// file -> { viewportHeight, prepare(page) => { locator } | { clip } | {} }
const CRATE_TARGETS = [
  {
    file: "crate-digger-request.png",
    prepare: async (page) => {
      await page.goto(`${BASE_URL}/crates`, { waitUntil: "networkidle", timeout: 90000 });
      await page.getByRole("link", { name: /Sunday sunset set/ }).waitFor({ timeout: 45000 });
      await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
      return {};
    },
  },
  {
    file: "crate-digger-crate.png",
    viewportHeight: 1376,
    prepare: async (page) => {
      await page.goto(`${BASE_URL}/crates`, { waitUntil: "networkidle", timeout: 90000 });
      await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
      await page.getByRole("button", { name: "Build crate" }).click();
      await page.waitForURL(`**/crates/${CRATE_ID}`, { timeout: 45000 });
      await page.getByText("6 of 8 found").waitFor({ timeout: 45000 });
      // A saved, titled crate, with the first line's license grants open.
      await page.getByLabel("Crate title").fill("Friday warm-up");
      await page.getByRole("button", { name: "Save crate" }).click();
      await page.getByText("Crate saved").waitFor();
      await page.getByText("Crate saved").waitFor({ state: "hidden", timeout: 15000 });
      await page.locator(".crates-line").first().getByText(/^License options/).click();
      return {};
    },
  },
  {
    // #1964: the quote panel the DJ approves before one signature buys the crate.
    file: "crate-digger-quote.png",
    viewportHeight: 2600,
    prepare: async (page) => {
      await page.goto(`${BASE_URL}/crates`, { waitUntil: "networkidle", timeout: 90000 });
      await page.getByLabel("What does your set need?").fill(CRATE_REQUEST_TEXT);
      await page.getByRole("button", { name: "Build crate" }).click();
      await page.waitForURL(`**/crates/${CRATE_ID}`, { timeout: 45000 });
      await page.getByText("6 of 8 found").waitFor({ timeout: 45000 });
      const panel = page.getByRole("region", { name: "Buy this crate" });
      await panel.getByRole("button", { name: "Get a quote" }).click();
      await panel.getByRole("heading", { name: "Your quote" }).waitFor({ timeout: 45000 });
      // A second stem on one line, so the picture shows more than the default.
      await panel.locator('.crates-quote-line[data-track-id="track-glass-harbour"]').getByLabel("Drums").click();
      await panel.getByText("2.5 USDC (about $2.50)").waitFor({ timeout: 45000 });
      return { locator: panel };
    },
  },
];

async function captureCrates(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  });
  await ctx.addInitScript((auth) => {
    localStorage.setItem("resonate.token", auth.token);
    localStorage.setItem("resonate.address", auth.address);
    localStorage.setItem("resonate.mock_auth", "true");
    sessionStorage.setItem("resonate.agent_onboarding_dismissed", "1");
  }, MOCK_AUTH);
  for (const target of CRATE_TARGETS) {
    if (process.env.CAPTURE_ONLY && target.file !== process.env.CAPTURE_ONLY) continue;
    // A fresh page per target: routes and crate state never leak between shots.
    const page = await ctx.newPage();
    // The quote shows a countdown: freeze the page's clock and the instant quotes
    // expire against, so "Prices are good for 10:00" reads the same on every run.
    await page.clock.setFixedTime(CRATE_CLOCK_MS);
    await mockCrateApi(page, { savedCrates: CRATE_LIST_SAMPLES, now: CRATE_CLOCK_MS });
    await page.setViewportSize({ width: 1440, height: target.viewportHeight ?? 900 });
    const shot = await target.prepare(page);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(1500);
    const out = path.join(OUT_DIR, target.file);
    if (shot.locator) await shot.locator.screenshot({ path: out });
    else if (shot.clip) await page.screenshot({ path: out, clip: shot.clip });
    else await page.screenshot({ path: out });
    console.log(`✓ [crates] ${target.file}`);
    await page.close();
  }
  await ctx.close();
}

async function main() {
  // CHROMIUM_EXECUTABLE_PATH: use an already-installed Chromium whose build
  // differs from the one this Playwright version expects.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    if (CAPTURE_PUBLIC) {
      const publicCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await capture(await publicCtx.newPage(), PUBLIC_TARGETS, "public");
      await publicCtx.close();
    }

    if (CAPTURE_AUTH) {
      const authCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await authCtx.addInitScript((auth) => {
        localStorage.setItem("resonate.token", auth.token);
        localStorage.setItem("resonate.address", auth.address);
        localStorage.setItem("resonate.mock_auth", "true");
      }, MOCK_AUTH);
      await capture(await authCtx.newPage(), AUTH_TARGETS, "signed-in");
      await authCtx.close();
    }

    if (CAPTURE_OWNER) {
      const ownerCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      const ownerPage = await ownerCtx.newPage();
      const ownerAuth = await loginSeededOwner(ownerPage);
      await ownerCtx.addInitScript((auth) => {
        localStorage.setItem("resonate.token", auth.token);
        localStorage.setItem("resonate.address", auth.address);
        localStorage.removeItem("resonate.mock_auth");
        sessionStorage.setItem("resonate.agent_onboarding_dismissed", "1");
      }, ownerAuth);
      await capture(ownerPage, OWNER_TARGETS, "seeded-owner");
      await ownerCtx.close();
    }

    if (CAPTURE_REMIX) await captureRemix(browser);
    if (CAPTURE_CRATES) await captureCrates(browser);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
