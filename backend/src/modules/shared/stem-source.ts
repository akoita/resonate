/**
 * Where a stem's audio comes from (#1976, ADR-TE-7, docs/features/official_stems.md).
 *
 * - `separated`: the ingestion worker split the uploaded mix (Demucs
 *   `htdemucs_6s`) and stored the result as MP3 320 kbps.
 * - `official`: the artist uploaded their own lossless (WAV or FLAC) part,
 *   aligned with the published mix.
 *
 * The full-mix rows (`original`, remix `master`) are not stems a buyer
 * licenses: they have no source. Pure; no I/O.
 */

export const STEM_SOURCES = ["separated", "official"] as const;
export type StemSourceValue = (typeof STEM_SOURCES)[number];

/** Separation model recorded for stems the ingestion worker produced. */
export const DEFAULT_SEPARATION_MODEL = "demucs-htdemucs-6s";

/** Labels shown wherever a stem is sold. */
export const STEM_SOURCE_LABELS: Readonly<Record<StemSourceValue, string>> = {
  official: "Official",
  separated: "Separated (AI)",
};

/** One plain sentence per source, for listings, quotes and receipts. */
export const STEM_SOURCE_DESCRIPTIONS: Readonly<Record<StemSourceValue, string>> = {
  official: "Lossless audio uploaded by the artist, aligned with the published mix.",
  separated: "Separated from the published mix by an AI model and stored as MP3 320 kbps.",
};

/** Stem types that are the full mix, not a stem a buyer licenses. */
export const MIX_STEM_TYPES: ReadonlySet<string> = new Set(["original", "master"]);

export function isMixStemType(type: string | null | undefined): boolean {
  return MIX_STEM_TYPES.has(String(type ?? "").trim().toLowerCase());
}

export function isStemSource(value: unknown): value is StemSourceValue {
  return typeof value === "string" && (STEM_SOURCES as readonly string[]).includes(value);
}

/**
 * The source of a stem row. A stored source wins; a legacy row that was never
 * backfilled counts as separated (every stem was, before #1976); a full-mix row
 * has none.
 */
export function resolveStemSource(row: {
  type?: string | null;
  source?: string | null;
}): StemSourceValue | null {
  if (isMixStemType(row.type)) return null;
  return isStemSource(row.source) ? row.source : "separated";
}

/** The label of a stem row's source, or null for a full-mix row. */
export function stemSourceLabel(row: { type?: string | null; source?: string | null }): string | null {
  const source = resolveStemSource(row);
  return source ? STEM_SOURCE_LABELS[source] : null;
}

/**
 * The source facts a quote, receipt or listing shows next to the license:
 * the machine value, the label, the plain description and, for a separated
 * stem, the model that separated it.
 */
export type StemSourceFacts = {
  source: StemSourceValue;
  label: string;
  description: string;
  separationModel: string | null;
  lossless: boolean;
};

export function stemSourceFacts(row: {
  type?: string | null;
  source?: string | null;
  separationModel?: string | null;
}): StemSourceFacts | null {
  const source = resolveStemSource(row);
  if (!source) return null;
  return {
    source,
    label: STEM_SOURCE_LABELS[source],
    description: STEM_SOURCE_DESCRIPTIONS[source],
    separationModel:
      source === "separated" ? row.separationModel?.trim() || DEFAULT_SEPARATION_MODEL : null,
    lossless: source === "official",
  };
}

/**
 * The flat source fields a listing, receipt row or stem page shows (#1976):
 * `source` and `sourceLabel` for the badge, `separationModel` for the tooltip,
 * `mimeType` for the delivered format. Null source fields on a full-mix row.
 */
export function stemSourceFields(row: {
  type?: string | null;
  source?: string | null;
  separationModel?: string | null;
  mimeType?: string | null;
}) {
  const facts = stemSourceFacts(row);
  return {
    source: facts?.source ?? null,
    sourceLabel: facts?.label ?? null,
    separationModel: facts?.separationModel ?? null,
    lossless: facts?.lossless ?? false,
    mimeType: row.mimeType ?? null,
  };
}
