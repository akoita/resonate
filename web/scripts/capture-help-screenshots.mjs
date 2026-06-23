/**
 * Capture the User Guide screenshots from a running Resonate instance.
 *
 * The in-app guide (`/help`) illustrates features with real screenshots.
 * Only public, no-login surfaces are captured here; authenticated pages
 * (Create, Upload, Settings, Disputes, AI DJ, Community, Library) currently
 * show a connect wall and are documented with text + deep links instead.
 *
 * Usage:
 *   # Against staging (default):
 *   node scripts/capture-help-screenshots.mjs
 *
 *   # Against a local instance:
 *   BASE_URL=http://localhost:3001 node scripts/capture-help-screenshots.mjs
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
const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/help/screenshots",
);

// route -> output filename. Keep in sync with figure `src` values in
// web/src/lib/help/content.ts.
const TARGETS = [
  ["/", "discover-home.png"],
  ["/catalog", "catalog.png"],
  ["/shows", "shows.png"],
  ["/shows/sennarin-paris", "show-campaign.png"],
  ["/marketplace", "marketplace.png"],
  ["/player", "player.png"],
  ["/wallet", "wallet.png"],
  ["/library", "connect-wallet.png"],
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const [route, file] of TARGETS) {
    const url = `${BASE_URL}${route}`;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    } catch (err) {
      console.warn(`! ${route}: ${String(err).slice(0, 80)}`);
    }
    // Let async client data settle before the shot.
    await page.waitForTimeout(3200);
    const out = path.join(OUT_DIR, file);
    await page.screenshot({ path: out });
    console.log(`✓ ${route} -> public/help/screenshots/${file}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
