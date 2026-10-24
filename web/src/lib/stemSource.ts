/**
 * Where a stem's audio comes from, and what each license tier lets the buyer
 * do, in plain words (#1976, ADR-TE-7). The wording mirrors the backend's
 * `stem-source.ts` and `stem_license_tier.ts` so the listing, the quote and the
 * receipt say the same thing.
 */

export type StemSource = "official" | "separated";

export const STEM_SOURCE_LABELS: Record<StemSource, string> = {
  official: "Official",
  separated: "Separated (AI)",
};

export const STEM_SOURCE_DESCRIPTIONS: Record<StemSource, string> = {
  official: "Lossless audio uploaded by the artist, aligned with the published mix.",
  separated: "Separated from the published mix by an AI model and delivered as MP3 320 kbps.",
};

/** The source filter of the marketplace and the Crate Digger. */
export const STEM_SOURCE_FILTERS = [
  { value: "all", label: "All sources" },
  { value: "official", label: STEM_SOURCE_LABELS.official },
  { value: "separated", label: STEM_SOURCE_LABELS.separated },
] as const;
export type StemSourceFilter = (typeof STEM_SOURCE_FILTERS)[number]["value"];

export const LICENSE_PLAIN_TERMS = {
  personal:
    "For your own listening and private use. You may not publish, share or monetize anything made with the stem.",
  remix:
    "Use the stem in a remix, mashup or new composition and publish it. Credit the original artist; the original is not re-released unmodified, and an ongoing royalty goes to the artist.",
  commercial:
    "Use the stem in monetized content such as ads, films, podcasts, live shows and branded content, with credit as agreed.",
} as const;

export function isStemSource(value: unknown): value is StemSource {
  return value === "official" || value === "separated";
}

/**
 * The source of a stem row. A full-mix row has none (null); a stem with no
 * recorded source counts as separated, as every stem was before official stems.
 */
export function resolveStemSource(
  stem: { type?: string | null; source?: string | null } | null | undefined,
): StemSource | null {
  if (!stem) return null;
  const type = String(stem.type ?? "").toLowerCase();
  if (type === "original" || type === "master") return null;
  return isStemSource(stem.source) ? stem.source : "separated";
}

/** Tooltip text: what the source means, and the model of a separated stem. */
export function stemSourceTitle(source: StemSource, separationModel?: string | null): string {
  const base = STEM_SOURCE_DESCRIPTIONS[source];
  return source === "separated" && separationModel ? `${base} Model: ${separationModel}.` : base;
}
