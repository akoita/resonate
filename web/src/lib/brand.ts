/**
 * Resonate brand identity: the one place code reads brand values from.
 *
 * Source: the Resonate brand book (2026-11). The guide, with usage rules and
 * the gaps we filled, lives in docs/brand/README.md. CSS reads the same colors
 * from the `--brand-*` tokens in src/styles/tokens.css; keep the two in sync.
 *
 * The logo is deliberately swappable. Every surface reads the source SVGs in
 * public/brand/: the sidebar renders BRAND_MARK_SRC, and the favicon, app
 * icons, social card and README banner are generated from them by
 * `npm run brand:assets`. Replace the SVGs, run the script, and the logo
 * changes everywhere.
 */

export const BRAND_NAME = "Resonate";

/** Public path of the brand mark (the symbol next to the wordmark). */
export const BRAND_MARK_SRC = "/brand/resonate-mark-on-dark.svg";

/** Web app manifest icons (generated). */
export const BRAND_APP_ICONS = {
  icon192: "/brand/icon-192.png",
  icon512: "/brand/icon-512.png",
  maskable512: "/brand/icon-maskable-512.png",
} as const;

/** Core palette from the brand book. Hex values, uppercase. */
export const BRAND_COLORS = {
  /** Canvas and dark backgrounds. */
  jetBlack: "#08080F",
  /** Text on dark, light backgrounds. */
  pureWhite: "#FFFFFF",
  /** Platform: navigation, structure, primary actions, AI. */
  hyacinthBlue: "#7C5CFF",
  /** Sound: playback, now playing, live energy. */
  tomatoRed: "#FF6B4A",
} as const;

/**
 * Accessible companions the brand book does not define. Hyacinth Blue as
 * *text* drops below WCAG AA (3.9:1) on raised surfaces, so text uses the
 * lighter tint, which stays at or above 4.8:1 on every app surface.
 */
export const BRAND_TEXT_COLORS = {
  hyacinthText: "#9880FF",
} as const;
