import type { MetadataRoute } from "next";
import { BRAND_APP_ICONS, BRAND_COLORS, BRAND_NAME } from "../lib/brand";
import { SITE_TAGLINE } from "../lib/seo";

/**
 * Web app manifest: name, colors and icons for "Add to Home Screen" and
 * installed-app surfaces. Icons are generated from public/brand/ by
 * `npm run brand:assets` (docs/brand/README.md). No service worker yet, so
 * this improves install metadata only; offline support is a separate task.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: SITE_TAGLINE,
    start_url: "/",
    display: "standalone",
    background_color: BRAND_COLORS.jetBlack,
    theme_color: BRAND_COLORS.jetBlack,
    icons: [
      { src: BRAND_APP_ICONS.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: BRAND_APP_ICONS.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: BRAND_APP_ICONS.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
