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
 *
 * Usage:
 *   # Public pass against staging (default):
 *   node scripts/capture-help-screenshots.mjs
 *
 *   # Both passes against a local instance:
 *   BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
 *
 *   # Skip the signed-in pass:
 *   CAPTURE_AUTH=false node scripts/capture-help-screenshots.mjs
 *
 *   # Seeded owner pass (run `npx prisma db seed` in the backend first):
 *   CAPTURE_PUBLIC=false CAPTURE_AUTH=false CAPTURE_OWNER=true \
 *     BASE_URL=http://localhost:3001 API_BASE_URL=http://localhost:3000 \
 *     node scripts/capture-help-screenshots.mjs
 *
 * Requirements: a Chromium browser for Playwright
 *   npx playwright install chromium
 *
 * Output: web/public/help/screenshots/*.png (1440x900 viewport, 1x; selected
 * data-heavy pages use a taller viewport so all documented panels appear).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://staging.resonate.pydes.xyz";
const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CAPTURE_PUBLIC = process.env.CAPTURE_PUBLIC !== "false";
const CAPTURE_AUTH = process.env.CAPTURE_AUTH !== "false";
const CAPTURE_OWNER = process.env.CAPTURE_OWNER === "true";
const OWNER_USER_ID = "e2e-user-00000000-0000-0000-0000-000000000001";
const OWNER_WALLET_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/help/screenshots",
);

// route -> output filename. Keep in sync with figure `src` values in
// web/src/lib/help/content.ts.
const PUBLIC_TARGETS = [
  ["/", "discover-home.png"],
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
  ["/settings", "settings.png"],
  ["/agent", "ai-dj.png"],
  ["/sonic-radar", "sonic-radar.png"],
  ["/library", "library.png"],
  ["/disputes", "disputes.png"],
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
    if (ready?.viewportHeight) {
      await page.setViewportSize({ width: 1440, height: ready.viewportHeight });
    }
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch (err) {
      console.warn(`! ${route}: ${String(err).slice(0, 80)}`);
    }
    await waitForRouteReady(page, route, ready);
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

async function main() {
  const browser = await chromium.launch();
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
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
