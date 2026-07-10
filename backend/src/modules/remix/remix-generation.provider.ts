import { Injectable } from "@nestjs/common";
import { estimateGenerationCostUsd } from "../generation/generation-cost-model";

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

export const REMIX_GENERATION_DEFAULT_DURATION_SECONDS = 30;

/** Provider/model path key for the remix stub in the per-path cost model. */
export const REMIX_STUB_COST_PATH = "remix-stub";

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

/**
 * Per-stem AI transform (#1316, P2 of epic #1311): scopes prompted generation
 * to one targeted operation instead of a whole-track reinterpretation.
 * `replace_stem` conditions on the OTHER stems (the bed) and asks for an
 * isolated replacement of the target role; `add_layer` conditions on the full
 * arrangement and asks for one new additive layer. Variation mode only.
 */
export type RemixStemTransform = {
  kind: "replace_stem" | "add_layer";
  /** Required for replace_stem: the project stem being replaced. */
  stemId?: string;
  /** Catalog label ("drums") for honest prompt framing and metadata. */
  stemLabel?: string;
};

/**
 * Pure validation shared by the enqueue path and tests. Returns a user-facing
 * problem string or null when the transform is acceptable for this project.
 */
export function validateStemTransform(
  transform: RemixStemTransform | undefined,
  project: {
    mode: string;
    stems: Array<{ stemId: string; muted: boolean }>;
  },
): string | null {
  if (!transform) return null;
  if (transform.kind !== "replace_stem" && transform.kind !== "add_layer") {
    return "stemTransform.kind must be replace_stem or add_layer";
  }
  if (project.mode !== "variation") {
    return "Per-stem AI transforms apply to variation mode only";
  }
  if (transform.kind === "add_layer") {
    if (transform.stemId) {
      return "stemTransform.stemId does not apply to add_layer";
    }
    return null;
  }
  if (!transform.stemId) {
    return "stemTransform.stemId is required for replace_stem";
  }
  const target = project.stems.find(
    (stem) => stem.stemId === transform.stemId,
  );
  if (!target) {
    return "stemTransform.stemId is not part of this project";
  }
  const bedHasAudio = project.stems.some(
    (stem) => stem.stemId !== transform.stemId && !stem.muted,
  );
  if (!bedHasAudio) {
    return "Replacing this stem would leave no unmuted stems to condition on; unmute another stem first";
  }
  return null;
}

/**
 * The transform's lead instruction — replaces the generic variation framing so
 * the model is asked for exactly one targeted output. Pure for testability;
 * used by the Lyria and audio-conditioned providers.
 */
export function stemTransformPromptLead(
  transform: RemixStemTransform,
  userPrompt: string,
): string {
  if (transform.kind === "replace_stem") {
    const label = transform.stemLabel?.trim() || "target stem";
    return `Generate an isolated ${label} track to replace the source ${label}: ${userPrompt}. Produce only the ${label} part — no other instruments.`;
  }
  return `Generate one new additive layer for the source arrangement: ${userPrompt}. Produce only that single layer so it can sit on top of the existing mix.`;
}

/**
 * A project's stem arrangement entry — the per-stem gain/mute the studio
 * preview models. Owned here (the provider boundary) so the shared
 * StemAudioMixer and RemixGenerationInput reference one definition without a
 * circular import.
 */
export type StemArrangementEntry = {
  stemId: string;
  gainDb: number | null;
  muted: boolean;
  /**
   * Section-grid play intervals (#1314), derived by the worker from the
   * stem's persisted mask and the project's section grid. Semantics:
   * undefined/null = fully active (no gating, pre-#1314 behavior);
   * [] = every section off (treated as muted); otherwise the stem is gated
   * to these spans with short edge fades.
   */
  activeIntervals?: Array<{ startSec: number; endSec: number }> | null;
};

/**
 * Worker-time render authorization (#1214). Built in the generation worker
 * *after* it re-verifies project ownership and current remix eligibility, then
 * threaded into the shared StemAudioMixer so encrypted source stems are only
 * ever decrypted for an owned, currently-eligible project. Never built from the
 * queue payload and never carries key material.
 */
export type StemRenderAuthorization = {
  /** Owner of the remix project (the source of the internal decrypt grant). */
  userId: string;
  remixProjectId: string;
  /**
   * Stem ids the worker re-confirmed as eligible for this render. The mixer
   * refuses to decrypt any encrypted stem that is not in this set.
   */
  authorizedStemIds: ReadonlySet<string>;
};

export type RemixGenerationOutputMetadata = {
  outputUri: string | null;
  /** Recorded at write time so playback never guesses from extensions. */
  mimeType: string | null;
  synthIdPresent: boolean | null;
  seed: number | null;
  sampleRate: number | null;
};

export type RemixGeneratedLayerMetadata = {
  kind: "generated_layer";
  provider: string;
  jobId: string;
  prompt: string | null;
  constraints: RemixGenerationConstraints;
  output: RemixGenerationOutputMetadata;
};

/**
 * Reproducible final-render settings recorded with every stem-backed draft
 * (#1210). This is deliberately separate from provider/layer metadata: it
 * describes the final audio artifact produced by Resonate.
 */
export type RemixRenderMetadata = {
  schemaVersion: string;
  targetLufs: number;
  loudnessRangeLufs: number;
  truePeakDbtp: number;
  outputCodec: "mp3";
  outputMimeType: "audio/mpeg";
  outputBitrateKbps: number;
  outputSampleRateHz: number;
  outputChannels: number;
  inputCount: number;
  activeStemCount: number;
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
  /**
   * The project's stem arrangement (gain/mute) at process time. Populated for
   * audio-conditioned generation (#1182 slice 4), which conditions on the
   * mixed unmuted stems; prompt-only providers (Lyria, stub) ignore it.
   */
  stemArrangement?: StemArrangementEntry[];
  /** Targeted per-stem operation (#1316); absent = whole-track behavior. */
  stemTransform?: RemixStemTransform;
  provenance: RemixGenerationProvenance;
};

export type RemixGenerationJob = {
  provider: string;
  jobId: string;
  estimatedCostUsd?: number;
  generatedLayers?: RemixGeneratedLayerMetadata[];
  sourceArrangement?: StemArrangementEntry[];
  renderMetadata?: RemixRenderMetadata;
  /** Placeholders shaped for durable provenance; D2/D3 fill them. */
  outputMetadata: RemixGenerationOutputMetadata;
};

export interface RemixGenerationProvider {
  /**
   * @param authorization Worker-time render grant (#1214). Providers that
   *   condition on the source stems (audio-conditioned) pass it to the mixer so
   *   encrypted stems can be decrypted; prompt-only providers ignore it.
   */
  createRemixDraft(
    input: RemixGenerationInput,
    authorization: StemRenderAuthorization,
  ): Promise<RemixGenerationJob>;
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
  stemTransform?: RemixStemTransform,
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
    ...(stemTransform ? { stemTransform } : {}),
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
  // Behavior-preserving: routes through the shared per-path cost model (#1421),
  // which defaults to the historical flat $0.06/30s for the remix-stub path.
  return estimateGenerationCostUsd(REMIX_STUB_COST_PATH, durationSeconds);
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
    _authorization: StemRenderAuthorization,
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
