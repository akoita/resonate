import { CRATE_STEM_TYPES } from "../crates/crate.types";
import { OFFICIAL_STEM_FORMATS } from "../shared/stem-media";

/**
 * Checks on an official stem package (#1976, ADR-TE-7, docs/features/official_stems.md).
 *
 * An artist uploads their own lossless parts for a published track. The package
 * is accepted only when it plausibly is the track's own parts, aligned with the
 * published mix: allowed stem types, a lossless container, a sample rate every
 * file shares, and each duration within a tolerance of the mix.
 *
 * A package may carry any non-empty subset of the stem types (#2379). Every
 * part is then judged on its own: not silent, not louder than the mix, and its
 * band-by-band loudness over time follows the mix's without an offset. Only a
 * package that supplies every part the track is sold with is also checked by
 * summing it and comparing the sum with the mix.
 *
 * Pure: it judges measurements the caller took (see official-stems.audio.ts), so
 * every rule is unit-testable and every refusal carries a readable reason.
 */

/** Stem types an official package may carry: the same six the catalog sells. */
export const OFFICIAL_STEM_TYPES = CRATE_STEM_TYPES;
export type OfficialStemType = (typeof OFFICIAL_STEM_TYPES)[number];

export function isOfficialStemType(value: unknown): value is OfficialStemType {
  return typeof value === "string" && (OFFICIAL_STEM_TYPES as readonly string[]).includes(value);
}

/** Largest single official stem file, in bytes (24-bit stereo 96 kHz, ~8 minutes). */
export const OFFICIAL_STEM_MAX_FILE_BYTES = 300 * 1024 * 1024;

/** Sample rates accepted (Hz). Every file of a package must use the same one. */
export const OFFICIAL_STEM_SAMPLE_RATES: readonly number[] = [
  44_100, 48_000, 88_200, 96_000, 176_400, 192_000,
];

/** A stem may be mono or stereo. */
export const OFFICIAL_STEM_CHANNELS: readonly number[] = [1, 2];

/**
 * A stem's duration may differ from the mix by at most
 * `max(DURATION_TOLERANCE_MIN_SECONDS, DURATION_TOLERANCE_RATIO x mix)`. The
 * floor covers encoder padding on the published MP3; the ratio keeps long
 * tracks from being refused for a fraction of a second.
 */
export const OFFICIAL_STEM_DURATION_TOLERANCE_MIN_SECONDS = 0.5;
export const OFFICIAL_STEM_DURATION_TOLERANCE_RATIO = 0.005;

/**
 * The summed stems must land within this many dB of the mix's RMS level. It is
 * wide on purpose: the master bus (limiter, loudness) legitimately moves the mix
 * a few dB from the plain sum of the parts.
 */
export const OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB = 6;

/**
 * Minimum Pearson correlation between the summed stems' and the mix's loudness
 * envelopes (100 ms frames). Aligned stems of a real master correlate above 0.95;
 * a file shifted by a fraction of a beat falls well below this.
 */
export const OFFICIAL_STEM_MIN_ENVELOPE_CORRELATION = 0.8;

/**
 * Per-part alignment (#2379). The part's loudness envelope (100 ms frames) is
 * compared with the mix's in each of these bands (Hz), so a quiet part is
 * judged where it is audible instead of against whatever is loudest.
 */
export const OFFICIAL_STEM_PART_BANDS_HZ: ReadonlyArray<readonly [number, number]> = [
  [0, 200],
  [200, 800],
  [800, 2000],
  [2000, 4000],
];

/** A frame counts for a band when the part is at least this fraction of its own peak there (-20 dB). */
export const OFFICIAL_STEM_PART_ACTIVE_RATIO = 0.1;
/** Fewer envelope frames than this (3 s) is too little to judge alignment on. */
export const OFFICIAL_STEM_PART_MIN_FRAMES = 30;
/** A band with fewer active frames than this is left out of the comparison. */
export const OFFICIAL_STEM_PART_MIN_ACTIVE_FRAMES = 10;
/** Shifts searched when looking for where the part really lines up: +-1 s. */
export const OFFICIAL_STEM_PART_MAX_LAG_FRAMES = 10;
/** An offset of up to this many frames (100 ms) is the tolerance, not a fault. */
export const OFFICIAL_STEM_PART_LAG_TOLERANCE_FRAMES = 1;

/**
 * A part is refused as shifted when correlating it at some other offset beats
 * the in-tolerance correlation by more than this margin.
 *
 * From the fixtures (`official_stems_fixtures.ts`, six parts of a synthetic
 * song, eight seeds, 20 s): aligned parts, including ones off by half a frame,
 * never exceed 0.29, while parts exported 0.3 s or more late exceed 0.35 for
 * every part with a rhythm of its own. A part with an almost steady level
 * (here the quiet guitar and "other") gives the check nothing to hold on to and
 * can slip through; the first-version limit is documented, not hidden.
 */
export const OFFICIAL_STEM_PART_OFFSET_MARGIN = 0.35;

/**
 * A part whose best in-tolerance correlation is below this follows nothing in
 * the mix (noise, or a badly shifted part). Aligned fixture parts, down to one
 * 19 dB under the whole mix, stay above 0.25 (above 0.09 when half a frame
 * off); badly shifted ones mostly fall below 0.05. A part of another song with
 * the same beat grid and instruments can still score 0.2 to 0.6, so this is not
 * a way to recognise a wrong track; only a complete package's sum is held to
 * the mix.
 */
export const OFFICIAL_STEM_PART_MIN_CORRELATION = 0.05;

/** A stem quieter than this RMS level (dBFS) is treated as silent. */
export const OFFICIAL_STEM_SILENCE_FLOOR_DB = -70;

/** What the caller measured about one audio file. */
export type OfficialStemAudioFacts = {
  /** Lower-case container as reported by the parser: "wav", "flac", "mp3", ... */
  container: string | null;
  /** Whether the codec is lossless (PCM or FLAC). */
  lossless: boolean;
  sampleRate: number | null;
  channels: number | null;
  durationSeconds: number | null;
};

export type OfficialStemCandidate = {
  type: string;
  /** The uploaded file name, shown in refusals. */
  fileName: string;
  size: number;
  audio: OfficialStemAudioFacts;
  /** RMS level in dBFS of the decoded stem, or null when not measured. */
  rmsDb?: number | null;
};

/** Level and alignment of the summed stems against the mix. */
export type SummedLevelMeasure = {
  mixRmsDb: number;
  summedRmsDb: number;
  /** summedRmsDb - mixRmsDb. */
  differenceDb: number;
  /** Envelope correlation, or null when the mix envelope is flat. */
  envelopeCorrelation: number | null;
};

/** How one part's loudness over time lines up with the mix (see `measurePartAlignment`). */
export type PartAlignmentMeasure = {
  /** Best correlation within the tolerated offset; null when there is too little to judge. */
  alignedCorrelation: number | null;
  /** Best correlation at an offset beyond the tolerance. */
  offsetCorrelation: number | null;
  /** Offset of that best match in 100 ms frames; positive when the part comes later than the mix. */
  offsetFrames: number | null;
  /** Part RMS minus mix RMS, in dB. */
  levelDifferenceDb: number;
};

export type OfficialStemIssueCode =
  | "no_files"
  | "unknown_type"
  | "duplicate_type"
  | "empty_file"
  | "file_too_large"
  | "unreadable_audio"
  | "not_lossless"
  | "unsupported_format"
  | "unsupported_sample_rate"
  | "mixed_sample_rates"
  | "unsupported_channels"
  | "duration_mismatch"
  | "silent_stem"
  | "summed_level_mismatch"
  | "part_louder_than_mix"
  | "misaligned";

export type OfficialStemIssue = {
  code: OfficialStemIssueCode;
  /** The stem type the issue is about, when it is about one file. */
  stemType?: string;
  /** A sentence an artist can act on. */
  message: string;
};

export function officialStemDurationToleranceSeconds(mixDurationSeconds: number): number {
  return Math.max(
    OFFICIAL_STEM_DURATION_TOLERANCE_MIN_SECONDS,
    OFFICIAL_STEM_DURATION_TOLERANCE_RATIO * Math.max(0, mixDurationSeconds),
  );
}

const ACCEPTED_CONTAINERS = new Set<string>(OFFICIAL_STEM_FORMATS.map((format) => format.extension));

/** "wav" or "flac" for a parser container name such as "WAVE" or "FLAC"; else null. */
export function officialStemContainer(container: string | null | undefined): "wav" | "flac" | null {
  const value = String(container ?? "").trim().toLowerCase();
  if (value === "wave" || value === "wav" || value === "riff") return "wav";
  if (value === "flac") return "flac";
  return null;
}

function seconds(value: number): string {
  return `${value.toFixed(1)} s`;
}

/**
 * Per-file and per-package checks that need no decoded audio. Returns every
 * issue found (not only the first) so an artist can fix a package in one go.
 */
export function validateOfficialStemFiles(input: {
  mixDurationSeconds: number | null;
  stems: readonly OfficialStemCandidate[];
}): OfficialStemIssue[] {
  const issues: OfficialStemIssue[] = [];
  if (input.stems.length === 0) {
    return [{ code: "no_files", message: "Add at least one stem file (vocals, drums, bass, guitar, piano or other)." }];
  }

  const seen = new Set<string>();
  const sampleRates = new Set<number>();
  for (const stem of input.stems) {
    const label = `${stem.type} (${stem.fileName})`;
    if (!isOfficialStemType(stem.type)) {
      issues.push({
        code: "unknown_type",
        stemType: stem.type,
        message: `"${stem.type}" is not a stem type. Use ${OFFICIAL_STEM_TYPES.join(", ")}.`,
      });
      continue;
    }
    if (seen.has(stem.type)) {
      issues.push({ code: "duplicate_type", stemType: stem.type, message: `Only one ${stem.type} file is allowed in a package.` });
      continue;
    }
    seen.add(stem.type);

    if (stem.size <= 0) {
      issues.push({ code: "empty_file", stemType: stem.type, message: `The ${label} file is empty.` });
      continue;
    }
    if (stem.size > OFFICIAL_STEM_MAX_FILE_BYTES) {
      issues.push({
        code: "file_too_large",
        stemType: stem.type,
        message: `The ${label} file is larger than ${Math.round(OFFICIAL_STEM_MAX_FILE_BYTES / (1024 * 1024))} MB.`,
      });
      continue;
    }

    const audio = stem.audio;
    const container = officialStemContainer(audio.container);
    if (!container || !ACCEPTED_CONTAINERS.has(container)) {
      issues.push(
        audio.container
          ? {
              code: "unsupported_format",
              stemType: stem.type,
              message: `The ${label} file must be WAV or FLAC (it looks like ${audio.container}).`,
            }
          : {
              code: "unreadable_audio",
              stemType: stem.type,
              message: `The ${label} file could not be read as audio. Official stems are WAV or FLAC files.`,
            },
      );
      continue;
    }
    if (audio.durationSeconds === null || !Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0) {
      issues.push({ code: "unreadable_audio", stemType: stem.type, message: `The ${label} file could not be read as audio.` });
      continue;
    }
    if (!audio.lossless) {
      issues.push({
        code: "not_lossless",
        stemType: stem.type,
        message: `The ${label} file is compressed (lossy) audio inside a ${container.toUpperCase()} file. Official stems are lossless.`,
      });
      continue;
    }
    if (audio.sampleRate === null || !OFFICIAL_STEM_SAMPLE_RATES.includes(audio.sampleRate)) {
      issues.push({
        code: "unsupported_sample_rate",
        stemType: stem.type,
        message: `The ${label} file is ${audio.sampleRate ?? "unknown"} Hz. Use ${OFFICIAL_STEM_SAMPLE_RATES.join(", ")} Hz.`,
      });
      continue;
    }
    sampleRates.add(audio.sampleRate);
    if (audio.channels === null || !OFFICIAL_STEM_CHANNELS.includes(audio.channels)) {
      issues.push({
        code: "unsupported_channels",
        stemType: stem.type,
        message: `The ${label} file has ${audio.channels ?? "an unknown number of"} channels. Use mono or stereo.`,
      });
      continue;
    }

    if (input.mixDurationSeconds !== null && Number.isFinite(input.mixDurationSeconds) && input.mixDurationSeconds > 0) {
      const tolerance = officialStemDurationToleranceSeconds(input.mixDurationSeconds);
      const difference = Math.abs(audio.durationSeconds - input.mixDurationSeconds);
      if (difference > tolerance) {
        issues.push({
          code: "duration_mismatch",
          stemType: stem.type,
          message:
            `The ${label} file is ${seconds(audio.durationSeconds)} long but the published mix is ` +
            `${seconds(input.mixDurationSeconds)} (at most ${seconds(tolerance)} apart is allowed). ` +
            "Export every stem from the same start point to the same end point as the mix.",
        });
        continue;
      }
    }
  }

  if (sampleRates.size > 1) {
    issues.push({
      code: "mixed_sample_rates",
      message: `The stems use different sample rates (${[...sampleRates].sort((a, b) => a - b).join(", ")} Hz). Export every stem at the same rate.`,
    });
  }
  return issues;
}

/** Stems whose decoded level is below the silence floor (needs `rmsDb`). */
export function validateOfficialStemSilence(stems: readonly OfficialStemCandidate[]): OfficialStemIssue[] {
  const issues: OfficialStemIssue[] = [];
  for (const stem of stems) {
    if (stem.rmsDb !== undefined && stem.rmsDb !== null && stem.rmsDb < OFFICIAL_STEM_SILENCE_FLOOR_DB) {
      issues.push({
        code: "silent_stem",
        stemType: stem.type,
        message: `The ${stem.type} (${stem.fileName}) file is silent.`,
      });
    }
  }
  return issues;
}

/**
 * The summed-level check: the stems, added sample for sample, must sound like
 * the mix. A wrong file, the wrong track, a file shifted in time or a package
 * missing most of the track fails here with a reason.
 */
export function validateSummedLevel(measure: SummedLevelMeasure): OfficialStemIssue[] {
  const issues: OfficialStemIssue[] = [];
  const difference = measure.differenceDb;
  if (Math.abs(difference) > OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB) {
    const direction = difference > 0 ? "louder" : "quieter";
    issues.push({
      code: "summed_level_mismatch",
      message:
        `Added together, the stems are ${Math.abs(difference).toFixed(1)} dB ${direction} than the published mix ` +
        `(at most ${OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB} dB apart is allowed). ` +
        (difference > 0
          ? "A file may be the full mix or another track, or the stems were exported with extra gain."
          : "The package may be missing stems: upload every part so that together they add up to the mix."),
    });
  }
  if (
    measure.envelopeCorrelation !== null &&
    measure.envelopeCorrelation < OFFICIAL_STEM_MIN_ENVELOPE_CORRELATION
  ) {
    issues.push({
      code: "misaligned",
      message:
        "The stems do not line up with the published mix: their loudness over time does not follow the mix. " +
        "Export every stem from the same start point as the mix, without trimming silence.",
    });
  }
  return issues;
}

/**
 * Whether a package supplies every part the track is sold with, which is when
 * the sum of the parts is expected to equal the mix. An unknown or empty
 * expectation is never "full": nothing is then compared with the sum.
 */
export function isCompleteOfficialSet(
  supplied: readonly string[],
  expected: readonly string[],
): boolean {
  if (expected.length === 0) return false;
  const have = new Set(supplied);
  return expected.every((type) => have.has(type));
}

/** Frames of 100 ms as seconds, for a message. */
function offsetSeconds(frames: number): string {
  return `${(Math.abs(frames) * 0.1).toFixed(1)} s`;
}

/**
 * The per-part check of a partial (or any) package: the part may not be louder
 * than the whole mix, and its loudness over time has to follow the mix's
 * without a shift. A part too short or too quiet to judge is not refused here.
 */
export function validatePartAlignment(
  part: { type: string; fileName: string },
  measure: PartAlignmentMeasure,
): OfficialStemIssue[] {
  const issues: OfficialStemIssue[] = [];
  const label = `${part.type} (${part.fileName})`;
  if (measure.levelDifferenceDb > OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB) {
    issues.push({
      code: "part_louder_than_mix",
      stemType: part.type,
      message:
        `The ${label} file is ${measure.levelDifferenceDb.toFixed(1)} dB louder than the whole published mix ` +
        `(at most ${OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB} dB is allowed). ` +
        "It may be the full mix or another track, or it was exported with extra gain.",
    });
  }
  const aligned = measure.alignedCorrelation;
  if (aligned === null) return issues;
  if (
    measure.offsetCorrelation !== null &&
    measure.offsetFrames !== null &&
    measure.offsetCorrelation - aligned > OFFICIAL_STEM_PART_OFFSET_MARGIN
  ) {
    const direction = measure.offsetFrames > 0 ? "later" : "earlier";
    issues.push({
      code: "misaligned",
      stemType: part.type,
      message:
        `The ${label} file does not line up with the published mix: it matches the mix about ` +
        `${offsetSeconds(measure.offsetFrames)} ${direction} than where it sits. ` +
        "Export every stem from the same start point as the mix, without trimming silence.",
    });
  } else if (aligned < OFFICIAL_STEM_PART_MIN_CORRELATION) {
    issues.push({
      code: "misaligned",
      stemType: part.type,
      message:
        `The ${label} file does not follow the published mix: its loudness over time matches nothing in it. ` +
        "Check that it is the right track and that it starts where the mix starts.",
    });
  }
  return issues;
}

/** Human summary of the first issue, for a single-line error. */
export function summarizeOfficialStemIssues(issues: readonly OfficialStemIssue[]): string {
  if (issues.length === 0) return "";
  if (issues.length === 1) return issues[0].message;
  return `${issues[0].message} (and ${issues.length - 1} more ${issues.length === 2 ? "problem" : "problems"})`;
}
