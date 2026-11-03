/**
 * Stem export (#2550, S6f-1 of #1903): the pre-master layer files a stem_mix
 * render writes when "Also render stems" is on, the `resonate-stems/v1`
 * manifest that travels with them, and why a draft has none.
 *
 * Each stem is one layer of the arrangement after its own chain (gate,
 * speed/key, gain, Pro EQ/pan/punch, automation, tone, echo) and before the
 * shared space reverb and every master stage (fades, build-ups, master tone,
 * warmth, loudness). All stems start at 0 and run the mix's length, so they
 * line up in a DAW and sum to the dry pre-master mix.
 */
import {
  REMIX_STEM_TAP_AUDIO_POLICY,
  REMIX_STEM_TAP_DSP_VERSION,
  type StemTapLayer,
} from "./stem-audio-mixer";

export const REMIX_STEMS_SCHEMA_VERSION = "resonate-stems/v1";

/** One stored stem file, as recorded in `generationMetadata.stems`. */
export type RenderedStemFile = {
  /** File name inside the zip, e.g. `01-vocals.flac`. */
  name: string;
  kind: StemTapLayer["kind"];
  label: string;
  stemId?: string;
  partRole?: string;
  uri: string;
  bytes: number;
};

/** `generationMetadata.stems` on a draft rendered with stems. */
export type RenderedStems = {
  schemaVersion: typeof REMIX_STEMS_SCHEMA_VERSION;
  dspVersion: string;
  format: {
    codec: string;
    bitDepth: number;
    sampleRateHz: number;
    channels: number;
  };
  files: RenderedStemFile[];
};

/** Why a draft can't be exported as stems. */
export type StemsExportReason = "no_draft" | "no_stems";

const KIND_LABELS: Record<StemTapLayer["kind"], string> = {
  stem: "Stem",
  beat: "Beat",
  part: "Part",
  ai_layer: "AI layer",
};

/** The human label of a layer: the stem's catalog label, "Beat", "Bass part". */
export function stemTapLabel(
  layer: StemTapLayer,
  stemLabels: Record<string, string>,
): string {
  if (layer.kind === "stem") {
    return (layer.stemId && stemLabels[layer.stemId]) || KIND_LABELS.stem;
  }
  if (layer.kind === "part" && layer.partRole) {
    const role = layer.partRole.replace(/[_-]+/g, " ").trim();
    return `${role.charAt(0).toUpperCase()}${role.slice(1)} part`;
  }
  return KIND_LABELS[layer.kind];
}

/** A file-name slug: lowercase ASCII words joined by "-", never empty. */
export function stemFileSlug(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "layer";
}

/** `01-vocals.flac`: input order, then the label, unique within a render. */
export function stemFileName(index: number, label: string): string {
  return `${String(index + 1).padStart(2, "0")}-${stemFileSlug(label)}${REMIX_STEM_TAP_AUDIO_POLICY.extension}`;
}

export function renderedStemsRecord(files: RenderedStemFile[]): RenderedStems {
  const policy = REMIX_STEM_TAP_AUDIO_POLICY;
  return {
    schemaVersion: REMIX_STEMS_SCHEMA_VERSION,
    dspVersion: REMIX_STEM_TAP_DSP_VERSION,
    format: {
      codec: policy.codec,
      bitDepth: policy.bitDepth,
      sampleRateHz: policy.sampleRateHz,
      channels: policy.channels,
    },
    files,
  };
}

/** Reads `generationMetadata.stems`; null when absent or malformed. */
export function parseRenderedStems(value: unknown): RenderedStems | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RenderedStems>;
  if (record.schemaVersion !== REMIX_STEMS_SCHEMA_VERSION) return null;
  if (!Array.isArray(record.files) || record.files.length === 0) return null;
  const files = record.files.filter(
    (file): file is RenderedStemFile =>
      !!file &&
      typeof file === "object" &&
      typeof file.name === "string" &&
      typeof file.uri === "string" &&
      typeof file.label === "string" &&
      typeof file.kind === "string",
  );
  if (files.length !== record.files.length) return null;
  return { ...(record as RenderedStems), files };
}

/** Every stored stem URI of a metadata object (for version deletes). */
export function renderedStemUris(value: unknown): string[] {
  return parseRenderedStems(value)?.files.map((file) => file.uri) ?? [];
}

/**
 * Stem export state: available when the current draft is completed and was
 * rendered with stems.
 */
export function stemsExportState(project: { generationMetadata: unknown }): {
  available: boolean;
  reason: StemsExportReason | null;
} {
  const metadata = project.generationMetadata as
    | { status?: unknown; stems?: unknown }
    | null;
  if (!metadata || metadata.status !== "completed") {
    return { available: false, reason: "no_draft" };
  }
  return parseRenderedStems(metadata.stems)
    ? { available: true, reason: null }
    : { available: false, reason: "no_stems" };
}

export type StemsManifestInput = {
  stems: RenderedStems;
  title: string;
  /** The draft's bar grid in draft seconds (#2540), when recorded. */
  draftGrid: { bpm: number; downbeatsSec: number[] } | null;
  lineage: {
    remixProjectId: string;
    sourceTrackId: string;
    sourceReleaseId: string | null;
    /** Mashups (#2559): the second source. */
    secondarySourceTrackId?: string;
    secondarySourceReleaseId?: string | null;
    generationJobId: string | null;
    policyVersion: string | null;
  };
};

/** The `resonate-stems/v1` manifest written into the zip as `stems.json`. */
export function stemsManifest(input: StemsManifestInput) {
  return {
    schemaVersion: REMIX_STEMS_SCHEMA_VERSION,
    dspVersion: input.stems.dspVersion,
    title: input.title,
    format: input.stems.format,
    note: "Pre-master stems: each layer after its own chain, before the shared reverb and the master stages. All files start at 0 and have the same length.",
    tempo: input.draftGrid
      ? { bpm: input.draftGrid.bpm, downbeatsSec: input.draftGrid.downbeatsSec }
      : null,
    files: input.stems.files.map((file) => ({
      name: file.name,
      kind: file.kind,
      label: file.label,
      ...(file.stemId ? { stemId: file.stemId } : {}),
      ...(file.partRole ? { partRole: file.partRole } : {}),
      bytes: file.bytes,
    })),
    lineage: input.lineage,
  };
}
