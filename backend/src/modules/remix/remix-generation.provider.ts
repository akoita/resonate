import { Injectable } from "@nestjs/common";

/**
 * Provider boundary for AI-assisted remix draft generation (#896, backlog D1).
 *
 * Remix Studio must never couple directly to a single model or vendor: the
 * project service talks only to this interface via the DI token, and concrete
 * providers (Lyria, audio-conditioned models, DSP/local tools) are bound in
 * RemixModule. The input carries explicit rights/policy context so provenance
 * is preserved from day one.
 */

export const REMIX_GENERATION_PROVIDER = "REMIX_GENERATION_PROVIDER";

/** Mirrors the catalog generation cost model ($0.06 per 30 seconds). */
export const REMIX_GENERATION_COST_PER_30_SECONDS_USD = 0.06;
export const REMIX_GENERATION_DEFAULT_DURATION_SECONDS = 30;

export const REMIX_GENERATION_ERROR_CODES = [
  "provider_disabled",
  "invalid_input",
  "provider_rejected",
  "provider_unavailable",
] as const;

export type RemixGenerationErrorCode =
  (typeof REMIX_GENERATION_ERROR_CODES)[number];

/**
 * Normalized provider failure. Categories mirror the catalog generation
 * stack's error mapping (rate-limit/unavailable, prompt rejection, invalid
 * request) so real providers can translate vendor errors directly.
 */
export class RemixGenerationProviderError extends Error {
  constructor(
    readonly code: RemixGenerationErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RemixGenerationProviderError";
  }
}

export type RemixGenerationConstraints = {
  durationSeconds?: number;
  bpm?: number;
  key?: string;
  explicitAllowed?: boolean;
};

/** Bounds enforced at the endpoint before any provider work (#1162). */
export const REMIX_GENERATION_SUPPORTED_DURATIONS = [30, 60, 120, 180] as const;
export const REMIX_GENERATION_BPM_MIN = 40;
export const REMIX_GENERATION_BPM_MAX = 220;
const REMIX_GENERATION_KEY_PATTERN = /^[A-G][#b]?m?(in|aj)?(or)?$/i;

/**
 * Pure runtime validation for client-submitted constraints. Returns the
 * field-level problems so the controller can answer 400 with specifics
 * instead of letting out-of-bounds values reach a paid provider.
 */
export function validateRemixGenerationConstraints(
  constraints: RemixGenerationConstraints | undefined,
): string[] {
  if (!constraints) return [];
  const problems: string[] = [];
  if (constraints.durationSeconds !== undefined) {
    if (
      !REMIX_GENERATION_SUPPORTED_DURATIONS.includes(
        constraints.durationSeconds as (typeof REMIX_GENERATION_SUPPORTED_DURATIONS)[number],
      )
    ) {
      problems.push(
        `constraints.durationSeconds must be one of: ${REMIX_GENERATION_SUPPORTED_DURATIONS.join(", ")}`,
      );
    }
  }
  if (constraints.bpm !== undefined) {
    if (
      !Number.isFinite(constraints.bpm) ||
      constraints.bpm < REMIX_GENERATION_BPM_MIN ||
      constraints.bpm > REMIX_GENERATION_BPM_MAX
    ) {
      problems.push(
        `constraints.bpm must be between ${REMIX_GENERATION_BPM_MIN} and ${REMIX_GENERATION_BPM_MAX}`,
      );
    }
  }
  if (constraints.key !== undefined) {
    if (
      typeof constraints.key !== "string" ||
      !REMIX_GENERATION_KEY_PATTERN.test(constraints.key.trim())
    ) {
      problems.push(
        'constraints.key must be a musical key such as "C", "F#", "Bbm", or "Am"',
      );
    }
  }
  if (
    constraints.explicitAllowed !== undefined &&
    typeof constraints.explicitAllowed !== "boolean"
  ) {
    problems.push("constraints.explicitAllowed must be a boolean");
  }
  return problems;
}

export type SourceFeatureHints = {
  bpm?: number;
  key?: string;
};

/**
 * Derives musical hints from the project's unmuted stems' worker-measured
 * features (#1184) for prompt conditioning (#1182 slice 3). Tempo comes from
 * the highest-confidence beat track, key from the highest-confidence
 * estimate; stems without v1 features contribute nothing. Pure so the
 * selection policy is unit-testable.
 */
const HINT_TONICS = new Set([
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Db", "Eb", "Gb", "Ab", "Bb",
]);

export function deriveSourceFeatureHints(
  stems: Array<{ muted?: boolean; audioFeatures?: unknown }>,
): SourceFeatureHints {
  let bpm: number | undefined;
  let bpmConfidence = -1;
  let key: string | undefined;
  let keyConfidence = -1;
  for (const stem of stems) {
    if (stem.muted) continue;
    const features = stem.audioFeatures as
      | {
          schemaVersion?: unknown;
          tempoBpm?: unknown;
          tempoConfidence?: unknown;
          key?: { tonic?: unknown; mode?: unknown; confidence?: unknown } | null;
        }
      | null
      | undefined;
    if (!features || features.schemaVersion !== "stem-audio-features/v1") {
      continue;
    }
    if (
      typeof features.tempoBpm === "number" &&
      Number.isFinite(features.tempoBpm) &&
      features.tempoBpm > 0
    ) {
      const confidence =
        typeof features.tempoConfidence === "number"
          ? features.tempoConfidence
          : 0;
      if (confidence > bpmConfidence) {
        bpmConfidence = confidence;
        bpm = Math.round(features.tempoBpm);
      }
    }
    const stemKey = features.key;
    // Tonic is enum-validated, not just typeof-checked: these strings reach
    // the vendor prompt, and a hand-edited row must not inject text.
    if (
      stemKey &&
      typeof stemKey.tonic === "string" &&
      HINT_TONICS.has(stemKey.tonic) &&
      (stemKey.mode === "major" || stemKey.mode === "minor")
    ) {
      const confidence =
        typeof stemKey.confidence === "number" ? stemKey.confidence : 0;
      if (confidence > keyConfidence) {
        keyConfidence = confidence;
        key = `${stemKey.tonic} ${stemKey.mode}`;
      }
    }
  }
  return {
    ...(bpm !== undefined ? { bpm } : {}),
    ...(key !== undefined ? { key } : {}),
  };
}

export type RemixGenerationProvenance = {
  remixProjectId: string;
  creatorUserId: string;
  licenseType: string;
  licenseId: string | null;
  sourceRightsRoute: string | null;
  sourceContentStatus: string;
  sourcePolicyVersion: string;
  /**
   * Voice/likeness generation is hard-disabled in the MVP policy context.
   * Typed as the literal `false` so no provider can receive `true` without a
   * deliberate type-level change reviewed against the consent policy.
   */
  voiceLikenessAllowed: false;
};

export type RemixGenerationInput = {
  sourceTrackId: string;
  stemIds: string[];
  mode: "stem_mix" | "variation" | "extension";
  /** Absent for stem_mix: prompts only apply to the prompted modes. */
  prompt?: string;
  constraints: RemixGenerationConstraints;
  /**
   * Measured tempo/key from the source stems (#1184), used as prompt
   * conditioning when the user sets no explicit constraint. Absent when no
   * stem carries features yet.
   */
  sourceFeatureHints?: SourceFeatureHints;
  provenance: RemixGenerationProvenance;
};

export type RemixGenerationJob = {
  provider: string;
  jobId: string;
  estimatedCostUsd?: number;
  /** Placeholders shaped for durable provenance; D2/D3 fill them. */
  outputMetadata: {
    outputUri: string | null;
    /** Recorded at write time so playback never guesses from extensions. */
    mimeType: string | null;
    synthIdPresent: boolean | null;
    seed: number | null;
    sampleRate: number | null;
  };
};

export interface RemixGenerationProvider {
  createRemixDraft(input: RemixGenerationInput): Promise<RemixGenerationJob>;
}

type ProjectForGeneration = {
  id: string;
  creatorUserId: string;
  sourceTrackId: string;
  mode: string;
  prompt: string | null;
  licenseType: string;
  licenseId: string | null;
  policyVersion: string;
  source: { rightsRoute: string | null; contentStatus: string };
  stems: Array<{ stemId: string; muted?: boolean; audioFeatures?: unknown }>;
};

/**
 * Pure input construction so policy context is testable: prompts are
 * stripped for stem_mix (generation must ignore stored prompts in that
 * mode — see RemixStudioEditor), and voice/likeness is always false.
 */
export function buildRemixGenerationInput(
  project: ProjectForGeneration,
  constraints: RemixGenerationConstraints = {},
): RemixGenerationInput {
  // Defensive (#1162 review prereq): the DB column is a plain string; an
  // unknown mode must fail the boundary contract, not flow to a provider.
  if (!["stem_mix", "variation", "extension"].includes(project.mode)) {
    throw new RemixGenerationProviderError(
      "invalid_input",
      `Unknown remix project mode: ${project.mode}`,
      false,
    );
  }
  const mode = project.mode as RemixGenerationInput["mode"];
  const prompt =
    mode === "stem_mix" ? undefined : project.prompt?.trim() || undefined;
  // Feature conditioning (#1182 slice 3) applies to prompted modes only;
  // stem_mix renders the audio itself and needs no hints.
  const hints =
    mode === "stem_mix" ? {} : deriveSourceFeatureHints(project.stems);
  const hasHints = hints.bpm !== undefined || hints.key !== undefined;
  return {
    sourceTrackId: project.sourceTrackId,
    stemIds: project.stems.map((stem) => stem.stemId),
    mode,
    ...(prompt ? { prompt } : {}),
    ...(hasHints ? { sourceFeatureHints: hints } : {}),
    constraints,
    provenance: {
      remixProjectId: project.id,
      creatorUserId: project.creatorUserId,
      licenseType: project.licenseType,
      licenseId: project.licenseId,
      sourceRightsRoute: project.source.rightsRoute,
      sourceContentStatus: project.source.contentStatus,
      sourcePolicyVersion: project.policyVersion,
      voiceLikenessAllowed: false,
    },
  };
}

export function estimateRemixGenerationCostUsd(
  durationSeconds: number = REMIX_GENERATION_DEFAULT_DURATION_SECONDS,
): number {
  return +(
    (durationSeconds / 30) *
    REMIX_GENERATION_COST_PER_30_SECONDS_USD
  ).toFixed(2);
}

/**
 * Default provider binding. Disabled outside dev/test unless
 * REMIX_GENERATION_ENABLED=true; when enabled it returns a deterministic job
 * without producing audio, so the endpoint contract, provenance persistence,
 * and event flow are exercisable before a real provider (D2) lands.
 */
@Injectable()
export class StubRemixGenerationProvider implements RemixGenerationProvider {
  static readonly PROVIDER_NAME = "remix-stub";

  async createRemixDraft(
    input: RemixGenerationInput,
  ): Promise<RemixGenerationJob> {
    if (process.env.REMIX_GENERATION_ENABLED !== "true") {
      throw new RemixGenerationProviderError(
        "provider_disabled",
        "AI remix generation is not enabled on this environment yet.",
        false,
      );
    }
    if (input.stemIds.length === 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "At least one source stem is required for remix generation.",
        false,
      );
    }
    return {
      provider: StubRemixGenerationProvider.PROVIDER_NAME,
      jobId: `rmxgen_${input.provenance.remixProjectId}`,
      estimatedCostUsd: estimateRemixGenerationCostUsd(
        input.constraints.durationSeconds,
      ),
      outputMetadata: {
        outputUri: null,
        mimeType: null,
        synthIdPresent: null,
        seed: null,
        sampleRate: null,
      },
    };
  }
}
