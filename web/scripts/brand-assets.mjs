#!/usr/bin/env node
/**
 * Regenerates every raster brand asset from the source SVGs in
 * web/public/brand/. Run after replacing the logo:
 *
 *   cd web && npm run brand:assets
 *
 * Plain Node + the Playwright Chromium the repo already uses for e2e tests,
 * so it runs the same for any agent or person (no design tool). Text uses Be
 * Vietnam Pro from Google Fonts, so it needs network access to that host.
 * Outputs (all committed):
 *   web/src/app/icon.svg              favicon (copy of the app-icon SVG)
 *   web/src/app/apple-icon.png        180x180 iOS home-screen icon
 *   web/public/brand/icon-192.png     web app manifest icons
 *   web/public/brand/icon-512.png
 *   web/public/brand/icon-maskable-512.png
 *   web/public/brand/og-default.png   1200x630 default social preview
 *   docs/brand/assets/readme-banner.png  GitHub README header (1600x480)
 *   desktop/build/icon.png            1024x1024 desktop app icon (electron-builder
 *                                     derives .ico/.icns from it)
 *
 * Guide: docs/brand/README.md.
 */
import { chromium } from "@playwright/test";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = path.join(webDir, "public", "brand");
const docsAssets = path.resolve(webDir, "..", "docs", "brand", "assets");
const desktopBuild = path.resolve(webDir, "..", "desktop", "build");

const BRAND = {
  jetBlack: "#08080F",
  hyacinth: "#7C5CFF",
  hyacinthText: "#9880FF",
  lavender: "#C4B5FD",
  white: "#FFFFFF",
};

const svgDataUrl = async (file) =>
  `data:image/svg+xml;base64,${(await readFile(path.join(brandDir, file))).toString("base64")}`;

/** Full-bleed render of one SVG at a square size. */
const iconHtml = (src, size) => `<!doctype html><html><body style="margin:0;background:transparent">
<img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;

/**
 * A dark brand card per the brand book (section 07): the lockup on Jet Black
 * with a soft Hyacinth glow from below, the tagline and subline. The only
 * Tomato on the card is the leg of the R.
 */
const cardHtml = ({ lockup, width, height, lockupHeight, tagline, subline }) => `<!doctype html>
<html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@500;600&display=block">
<style>
  html,body{margin:0}
  body{width:${width}px;height:${height}px;overflow:hidden;background:${BRAND.jetBlack};
    font-family:"Be Vietnam Pro",system-ui,sans-serif;color:${BRAND.white};position:relative;
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
  .glow{position:absolute;left:50%;bottom:-${Math.round(height * 0.55)}px;transform:translateX(-50%);
    width:${Math.round(width * 1.1)}px;height:${Math.round(height * 1.1)}px;border-radius:50%;
    background:radial-gradient(closest-side, rgba(124,92,255,.42), rgba(124,92,255,.12) 55%, transparent)}
  .lockup{height:${lockupHeight}px;display:block;position:relative}
  .tagline{position:relative;margin-top:${Math.round(lockupHeight * 0.28)}px;font-size:${Math.round(lockupHeight * 0.36)}px;
    font-weight:600;letter-spacing:-0.01em}
  .subline{position:relative;margin-top:${Math.round(lockupHeight * 0.14)}px;font-size:${Math.round(lockupHeight * 0.2)}px;
    font-weight:500;color:${BRAND.lavender}}
</style></head><body>
<div class="glow"></div>
<img class="lockup" src="${lockup}">
${tagline ? `<div class="tagline">${tagline}</div>` : ""}
${subline ? `<div class="subline">${subline}</div>` : ""}
</body></html>`;

// Tagline approved with the brand book (docs/brand/README.md).
const TAGLINE = "Fair music, from stem to stage.";
const SUBLINE = "Streaming · Stem licensing · Remixes · Fan-funded shows";

async function shot(browser, html, { width, height, out, transparent = false }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: transparent });
  await page.close();
  console.log("wrote", path.relative(path.resolve(webDir, ".."), out));
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
try {
  const appIcon = await svgDataUrl("resonate-app-icon.svg");
  const maskable = await svgDataUrl("resonate-app-icon-maskable.svg");
  const lockup = await svgDataUrl("resonate-lockup-on-dark.svg");

  await copyFile(path.join(brandDir, "resonate-app-icon.svg"), path.join(webDir, "src", "app", "icon.svg"));
  console.log("wrote web/src/app/icon.svg");
  await shot(browser, iconHtml(appIcon, 180), { width: 180, height: 180, out: path.join(webDir, "src", "app", "apple-icon.png"), transparent: true });
  for (const size of [192, 512]) {
    await shot(browser, iconHtml(appIcon, size), { width: size, height: size, out: path.join(brandDir, `icon-${size}.png`), transparent: true });
  }
  await mkdir(desktopBuild, { recursive: true });
  await shot(browser, iconHtml(appIcon, 1024), { width: 1024, height: 1024, out: path.join(desktopBuild, "icon.png"), transparent: true });
  await shot(browser, iconHtml(maskable, 512), { width: 512, height: 512, out: path.join(brandDir, "icon-maskable-512.png") });

  await shot(browser, cardHtml({ lockup, width: 1200, height: 630, lockupHeight: 120, tagline: TAGLINE, subline: SUBLINE }),
    { width: 1200, height: 630, out: path.join(brandDir, "og-default.png") });
  await shot(browser, cardHtml({ lockup, width: 1600, height: 480, lockupHeight: 110, tagline: TAGLINE, subline: SUBLINE }),
    { width: 1600, height: 480, out: path.join(docsAssets, "readme-banner.png") });
} finally {
  await browser.close();
}
