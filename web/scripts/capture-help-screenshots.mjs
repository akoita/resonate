/**
 * Capture the User Guide screenshots from a running Resonate instance.
 *
 * The in-app guide (`/help`) illustrates features with real screenshots.
 * Two passes:
 *   - PUBLIC pass: no-login surfaces (Discover, Catalog, Shows, Marketplace,
 *     Player, Wallet, and the connect wall). Best captured against staging.
 *   - SIGNED-IN pass: pages behind the connect wall (Upload, Create, Settings,
 *     AI DJ, Sonic Radar, Library, Disputes). These can't be reached publicly,
 *     so we inject the same mock-auth localStorage the E2E tests use
 *     (web/tests/auth.setup.ts) to render the signed-in shells. Run this pass
 *     against a LOCAL instance (BASE_URL=http://localhost:3001) for clean,
 *     stable previews. Data-heavy owner views (analytics, managed catalog,
 *     community benefits) need a seeded backend and are intentionally skipped.
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
 * Requirements: a Chromium browser for Playwright
 *   npx playwright install chromium
 *
 * Output: web/public/help/screenshots/*.png (1440x900, 1x).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://staging.resonate.pydes.xyz";
const CAPTURE_AUTH = process.env.CAPTURE_AUTH !== "false";
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

// Mock auth identical to web/tests/auth.setup.ts — a non-cryptographic JWT the
// frontend accepts (role: artist). Activates the client mock-auth path via the
// `resonate.mock_auth` localStorage flag, so no rebuild/env change is needed.
const MOCK_AUTH = {
  address: "0x742d35cc6634c0532925a3b844bc9e7595f1ea2c",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJyb2xlIjoiYXJ0aXN0IiwiYWRkcmVzcyI6IjB4NzQyZDM1Y2M2NjM0YzA1MzI5MjVhM2I4NDRiYzllNzU5NWYxZWEyYyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxODAwMDAwMDAwfQ.mock-signature",
};

async function capture(page, targets) {
  for (const [route, file] of targets) {
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 45000 });
    } catch (err) {
      console.warn(`! ${route}: ${String(err).slice(0, 80)}`);
    }
    // Let async client data settle before the shot.
    await page.waitForTimeout(3200);
    await page.screenshot({ path: path.join(OUT_DIR, file) });
    console.log(`✓ ${route} -> public/help/screenshots/${file}`);
  }
}

async function main() {
  const browser = await chromium.launch();

  const publicCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await capture(await publicCtx.newPage(), PUBLIC_TARGETS);
  await publicCtx.close();

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
    await capture(await authCtx.newPage(), AUTH_TARGETS);
    await authCtx.close();
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
