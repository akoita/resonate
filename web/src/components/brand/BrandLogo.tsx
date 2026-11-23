import { BRAND_MARK_SRC, BRAND_NAME } from "../../lib/brand";

type BrandLogoProps = {
  /** Height of the mark in CSS pixels. The wordmark scales from it. */
  size?: number;
  /** Show the "Resonate" wordmark beside the mark. */
  showWordmark?: boolean;
  /** Element used for the wordmark (the sidebar keeps its heading). */
  wordmarkAs?: "span" | "h2";
  className?: string;
};

/**
 * The Resonate logo lockup: brand mark plus wordmark in the brand typeface.
 * The mark comes from a single file (BRAND_MARK_SRC) so it can be swapped
 * without touching components. See docs/brand/README.md.
 */
export function BrandLogo({
  size = 28,
  showWordmark = true,
  wordmarkAs: Wordmark = "span",
  className,
}: BrandLogoProps) {
  return (
    <span className={["brand-logo", className].filter(Boolean).join(" ")}>
      {/* A plain img: the mark is a tiny static SVG and must not go through
        * the image optimizer. Decorative when the wordmark is shown. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-logo__mark"
        src={BRAND_MARK_SRC}
        width={size}
        height={size}
        alt={showWordmark ? "" : BRAND_NAME}
        aria-hidden={showWordmark ? true : undefined}
      />
      {showWordmark ? <Wordmark className="brand-logo__wordmark logo-text">{BRAND_NAME}</Wordmark> : null}
    </span>
  );
}
