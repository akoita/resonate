import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { prisma } from "../../db/prisma";
import {
  EncryptionService,
  RenderDecryptionError,
} from "../encryption/encryption.service";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type RemixRenderMetadata,
  type StemArrangementEntry,
  type StemRenderAuthorization,
} from "./remix-generation.provider";
import { normalizeRemixStemGainDb } from "./remix-gain";
import {
  buildSectionGateVolumeExpression,
  type SectionInterval,
} from "./remix-arrangement";
import {
  echoTaps,
  REMIX_FX_DSP_VERSION,
  REMIX_FX_FILTER_Q,
  REMIX_FX_IMPULSE,
  reverbWet,
  toneFilter,
  warmthK,
  writeImpulseWav,
  type RemixFxRecipe,
  type RemixFxStem,
  type RemixRenderFx,
} from "./remix-fx";

const execFileAsync = promisify(execFile);

export const STEM_AUDIO_MIXER = "STEM_AUDIO_MIXER";

const FFMPEG_TIMEOUT_MS = 120_000;

/**
 * Product audio policy, not environment configuration. Identical saved
 * arrangements must render identically across environments; changing any
 * value requires a schema-version bump so old drafts remain auditable.
 */
export const REMIX_RENDER_AUDIO_POLICY = Object.freeze({
  schemaVersion: "remix-render-policy/v1",
  targetLufs: -14,
  loudnessRangeLufs: 11,
  truePeakDbtp: -1.5,
  outputCodec: "mp3" as const,
  outputMimeType: "audio/mpeg" as const,
  outputBitrateKbps: 320,
  outputSampleRateHz: 48_000,
  outputChannels: 2,
});

// Re-exported for back-compat: the canonical definition lives in the provider
// boundary so RemixGenerationInput and the mixer share one type.
export type { StemArrangementEntry };

export type MixedStemAudio = {
  buffer: Buffer;
  mimeType: string;
  /** Number of unmuted stems that went into the mix. */
  stemCount: number;
  renderMetadata: RemixRenderMetadata;
};

export type AudioBufferMixInput = {
  buffer: Buffer;
  mimeType: string;
  gainDb?: number | null;
  label: string;
};

export type MixedAudioBuffers = {
  buffer: Buffer;
  mimeType: string;
  inputCount: number;
  renderMetadata: RemixRenderMetadata;
};

/**
 * Mixes a project's unmuted stems into one audio buffer. Extracted from the
 * stem_mix renderer (#1189) so audio-conditioned generation (#1182 slice 4)
 * conditions on exactly what the user arranged, and the encrypted-stem
 * decrypt-for-render boundary (#1214) + path-traversal containment live in one
 * place.
 *
 * Every caller passes a {@link StemRenderAuthorization} the generation worker
 * built after re-verifying project ownership and current eligibility. Encrypted
 * source stems are decrypted in memory into the mixer's unique temp dir and
 * never persisted or returned individually.
 */
export interface StemAudioMixer {
  /**
   * @param fx Shared effects recipe (#1897) + grid tempo; absent = the
   *   pre-#1897 graph, byte-identical.
   */
  mixUnmutedStems(
    stems: StemArrangementEntry[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
  ): Promise<MixedStemAudio>;
  mixUnmutedStemsWithAudioBuffers(
    stems: StemArrangementEntry[],
    inputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
  ): Promise<MixedAudioBuffers>;
}

export type StemMixFfmpegInput = {
  path: string;
  gainDb: number;
  /** Section-grid gating (#1314); undefined/null = play the whole stem. */
  activeIntervals?: SectionInterval[] | null;
  /** Project stem id keying this input's per-stem fx (#1897). */
  fxStemId?: string;
  /**
   * AI-generated layer input (#1209): varispeed applies, per-stem fx do not,
   * and it sends `master.space` to the reverb bus (#1897).
   */
  aiLayer?: boolean;
};

/** Effects context for {@link buildStemMixFfmpegArgs} (#1897). */
export type StemMixFfmpegFx = {
  effects: RemixFxRecipe | null;
  /** Grid tempo for echo timing; null/undefined = the 0.375 s fallback. */
  bpm?: number | null;
  /** Stereo reverb IR WAV; required when any input sends to the reverb bus. */
  impulsePath?: string | null;
  /**
   * afir options that disable its IR auto-gain so the bus is a plain
   * convolution with the energy-normalized IR. ffmpeg >= 7 needs
   * `irnorm=-1` (default); `gtype` is a deprecated no-op there.
   */
  afirOptions?: string;
};

/** Default afir options: no IR normalization (ffmpeg >= 7.0). */
export const AFIR_UNITY_GAIN_OPTIONS = "irnorm=-1";

/**
 * Pure arg construction (unit-tested without ffmpeg). Inputs are passed as an
 * execFile argument array — stem-derived values are never interpolated into a
 * shell string. Per-stem gain applies as an ffmpeg volume filter (dB), then
 * amix sums to the longest input without renormalizing each source down,
 * matching the studio's preview gain model.
 *
 * With a non-null effects recipe (#1897) the graph gains the remix-fx/v1
 * chain (see {@link buildFxStemMixFilter}); without one the args are
 * byte-identical to the pre-#1897 graph.
 */
export function buildStemMixFfmpegArgs(
  inputs: StemMixFfmpegInput[],
  outputPath: string,
  fx?: StemMixFfmpegFx | null,
): string[] {
  if (inputs.length === 0) {
    throw new RemixGenerationProviderError(
      "invalid_input",
      "A stem mix render needs at least one unmuted stem.",
      false,
    );
  }
  // -loglevel error keeps execFile's stderr buffer tiny on long renders.
  const args: string[] = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error"];
  for (const input of inputs) {
    args.push("-i", input.path);
  }
  if (fx?.effects) {
    const { filter, needsImpulse } = buildFxStemMixFilter(inputs, fx);
    if (needsImpulse) {
      if (!fx.impulsePath) {
        throw new Error("A reverb send needs the impulse response file path.");
      }
      args.push("-i", fx.impulsePath);
    }
    return pushOutputArgs(args, filter, outputPath);
  }
  const labelled = inputs.map((input, index) => {
    const gain = normalizeRemixStemGainDb(input.gainDb);
    // Section gating (#1314) applies after the user's static gain: a generated
    // per-frame volume envelope with short edge fades. The expression contains
    // only validated numeric spans (commas escaped for the filtergraph
    // parser), never user strings. Fully-active stems skip the filter so
    // untouched arrangements render byte-identically to pre-#1314.
    const gate =
      input.activeIntervals && input.activeIntervals.length > 0
        ? `,volume=volume=${buildSectionGateVolumeExpression(input.activeIntervals)}:eval=frame`
        : "";
    return `[${index}:a]volume=${gain}dB${gate}[a${index}]`;
  });
  const mixInputs = inputs.map((_, index) => `[a${index}]`).join("");
  const filter = `${labelled.join(";")};${mixInputs}amix=inputs=${inputs.length}:duration=longest:normalize=0[sum];[sum]${loudnormFilter()}[mix]`;
  return pushOutputArgs(args, filter, outputPath);
}

function loudnormFilter(): string {
  const policy = REMIX_RENDER_AUDIO_POLICY;
  return `loudnorm=I=${policy.targetLufs}:LRA=${policy.loudnessRangeLufs}:TP=${policy.truePeakDbtp}`;
}

function pushOutputArgs(
  args: string[],
  filter: string,
  outputPath: string,
): string[] {
  const policy = REMIX_RENDER_AUDIO_POLICY;
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[mix]",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${policy.outputBitrateKbps}k`,
    "-ar",
    String(policy.outputSampleRateHz),
    "-ac",
    String(policy.outputChannels),
    outputPath,
  );
  return args;
}

/** Filter-graph number: finite, ≤ 6 decimals, never exponent notation. */
function fxNum(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Non-finite value in the effects filter graph.");
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
}

function fxToneFilter(tone: number | undefined): string | null {
  const filter = toneFilter(tone ?? 0);
  if (!filter) return null;
  return `${filter.type}=f=${fxNum(filter.frequencyHz)}:width_type=q:width=${fxNum(REMIX_FX_FILTER_Q)}`;
}

function stemFxFor(
  effects: RemixFxRecipe,
  input: StemMixFfmpegInput,
): RemixFxStem {
  if (input.aiLayer || !input.fxStemId) return {};
  return effects.stems?.[input.fxStemId] ?? {};
}

/** Per-input reverb wet level (0 = no send). AI layers send master.space. */
export function stemMixReverbSends(
  inputs: StemMixFfmpegInput[],
  effects: RemixFxRecipe | null,
): number[] {
  if (!effects) return inputs.map(() => 0);
  const masterSpace = effects.master?.space ?? 0;
  return inputs.map((input) =>
    reverbWet(stemFxFor(effects, input).space ?? 0, masterSpace),
  );
}

/**
 * remix-fx/v1 render graph (#1897), in the contract order:
 *  - per input: aresample=48000 (float) → varispeed (asetrate=48000·s,
 *    aresample=48000) → gain dB → section gate with intervals ÷ s (output
 *    time) → [stems only] tone → echo (aecho, feed-forward taps) → asplit into
 *    dry + a reverb send scaled by its wet level;
 *  - reverb bus: amix(sends) → apad by the IR length → afir with the
 *    energy-normalized stereo IR and afir's own IR auto-gain disabled (plain
 *    convolution). afir stops at its input's EOF, so the pad sits BEFORE it:
 *    afir convolves the padded silence and the full IR tail rings out after
 *    the last send ends (padding after afir would only append silence);
 *  - master: amix(dry + AI layers + reverb) → master tone → warmth
 *    tanh(k·x)/tanh(k) → the versioned loudness policy.
 * Every value is numeric and derived from the validated recipe.
 */
export function buildFxStemMixFilter(
  inputs: StemMixFfmpegInput[],
  fx: StemMixFfmpegFx,
): { filter: string; needsImpulse: boolean } {
  const effects = fx.effects;
  if (!effects) {
    throw new Error("buildFxStemMixFilter requires an effects recipe.");
  }
  const master = effects.master ?? {};
  // speed has 2 decimals, so 48000·s = 480·(100·s) is an exact integer rate.
  const speedHundredths = Math.round((master.speed ?? 1) * 100);
  const speed = speedHundredths / 100;
  const bpm = fx.bpm ?? null;
  const sends = stemMixReverbSends(inputs, effects);
  const needsImpulse = sends.some((wet) => wet > 0);

  const graph: string[] = [];
  const dryLabels: string[] = [];
  const wetLabels: string[] = [];
  inputs.forEach((input, index) => {
    const stemFx = stemFxFor(effects, input);
    // aformat pins float processing so gain/echo never clip in an integer
    // sample format before the loudness policy (the preview is float too).
    const chain: string[] = ["aresample=48000", "aformat=sample_fmts=fltp"];
    if (speedHundredths !== 100) {
      chain.push(`asetrate=${480 * speedHundredths}`, "aresample=48000");
    }
    chain.push(`volume=${normalizeRemixStemGainDb(input.gainDb)}dB`);
    if (input.activeIntervals && input.activeIntervals.length > 0) {
      // The gate runs after varispeed, i.e. in output time.
      const scaled = input.activeIntervals.map((interval) => ({
        startSec: interval.startSec / speed,
        endSec: interval.endSec / speed,
      }));
      chain.push(
        `volume=volume=${buildSectionGateVolumeExpression(scaled)}:eval=frame`,
      );
    }
    if (!input.aiLayer) {
      const tone = fxToneFilter(stemFx.tone);
      if (tone) chain.push(tone);
      const taps = echoTaps(stemFx.echo ?? 0, bpm, speed);
      if (taps.length > 0) {
        const delays = taps.map((tap) => fxNum(tap.delaySec * 1000)).join("|");
        const decays = taps.map((tap) => fxNum(tap.gain)).join("|");
        chain.push(
          `aecho=in_gain=1:out_gain=1:delays=${delays}:decays=${decays}`,
        );
      }
    }
    if (sends[index] > 0) {
      graph.push(`[${index}:a]${chain.join(",")},asplit=2[d${index}][s${index}]`);
      graph.push(`[s${index}]volume=${fxNum(sends[index])}[w${index}]`);
      dryLabels.push(`[d${index}]`);
      wetLabels.push(`[w${index}]`);
    } else {
      graph.push(`[${index}:a]${chain.join(",")}[a${index}]`);
      dryLabels.push(`[a${index}]`);
    }
  });

  if (needsImpulse) {
    const irIndex = inputs.length;
    const afirOptions = fx.afirOptions ?? AFIR_UNITY_GAIN_OPTIONS;
    // Stereo bus so afir convolves L/R with the IR's own L/R channels; the
    // pad lets the natural reverb tail ring out (master amix is "longest").
    graph.push(
      `${wetLabels.join("")}amix=inputs=${wetLabels.length}:duration=longest:normalize=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=pad_dur=${fxNum(REMIX_FX_IMPULSE.lengthSeconds)}[rvin]`,
    );
    graph.push(`[rvin][${irIndex}:a]afir=${afirOptions}[rv]`);
    dryLabels.push("[rv]");
  }

  const masterChain: string[] = [];
  const masterTone = fxToneFilter(master.tone);
  if (masterTone) masterChain.push(masterTone);
  const warmth = master.warmth ?? 0;
  if (warmth > 0) {
    const k = fxNum(warmthK(warmth));
    masterChain.push(
      `aeval=exprs=tanh(${k}*val(ch))/tanh(${k}):channel_layout=same`,
    );
  }
  masterChain.push(loudnormFilter());
  graph.push(
    `${dryLabels.join("")}amix=inputs=${dryLabels.length}:duration=longest:normalize=0[sum]`,
  );
  graph.push(`[sum]${masterChain.join(",")}[mix]`);
  return { filter: graph.join(";"), needsImpulse };
}

let afirOptionsProbe: Promise<string> | null = null;

/**
 * Picks the afir options that make the reverb bus a plain convolution on the
 * installed ffmpeg (#1897). ffmpeg >= 7 normalizes the IR by default and only
 * `irnorm=-1` disables it (`gtype` became a no-op). Older builds lack
 * `irnorm`; there `gtype=none` disables auto-gain — exact on 6.x, but 5.x
 * applies an extra 2x inverse-FFT scale, so parity is only guaranteed on the
 * production ffmpeg (>= 7). Memoized per process.
 */
export function resolveAfirUnityGainOptions(logger?: Logger): Promise<string> {
  afirOptionsProbe ??= execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-h", "filter=afir"],
    { timeout: 15_000 },
  )
    .then(({ stdout }) => {
      if (/\birnorm\b/.test(String(stdout))) return AFIR_UNITY_GAIN_OPTIONS;
      logger?.warn(
        "ffmpeg afir has no irnorm option (ffmpeg < 7); using gtype=none — reverb level parity with the preview is only guaranteed on ffmpeg >= 7.",
      );
      return "gtype=none";
    })
    .catch(() => {
      // Probe failures are retried next render; the render itself surfaces
      // any real ffmpeg problem.
      afirOptionsProbe = null;
      return AFIR_UNITY_GAIN_OPTIONS;
    });
  return afirOptionsProbe;
}

function renderMetadata(
  inputCount: number,
  activeStemCount: number,
  fx?: RemixRenderFx,
): RemixRenderMetadata {
  return {
    ...REMIX_RENDER_AUDIO_POLICY,
    inputCount,
    activeStemCount,
    // #1897: the exact recipe + DSP version this artifact was rendered with.
    ...(fx
      ? { effects: fx.effects, effectsDspVersion: REMIX_FX_DSP_VERSION }
      : {}),
  };
}

@Injectable()
export class FfmpegStemAudioMixer implements StemAudioMixer {
  private readonly logger = new Logger(FfmpegStemAudioMixer.name);

  constructor(
    private readonly storageProvider: StorageProvider,
    private readonly encryptionService: EncryptionService,
  ) {}

  async mixUnmutedStems(
    stems: StemArrangementEntry[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
  ): Promise<MixedStemAudio> {
    return this.mixStemArrangement(stems, [], authorization, true, fx);
  }

  async mixUnmutedStemsWithAudioBuffers(
    stems: StemArrangementEntry[],
    inputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    fx?: RemixRenderFx,
  ): Promise<MixedAudioBuffers> {
    return this.mixStemArrangement(stems, inputs, authorization, false, fx);
  }

  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: true,
    fx?: RemixRenderFx,
  ): Promise<MixedStemAudio>;
  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: false,
    fx?: RemixRenderFx,
  ): Promise<MixedAudioBuffers>;
  private async mixStemArrangement(
    stems: StemArrangementEntry[],
    additionalInputs: AudioBufferMixInput[],
    authorization: StemRenderAuthorization,
    stemOnly: boolean,
    fx?: RemixRenderFx,
  ): Promise<MixedStemAudio | MixedAudioBuffers> {
    const label = authorization.remixProjectId;
    // A stem whose section mask disables every section ([]) is effectively
    // muted (#1314); undefined/null intervals mean fully active.
    const activeStems = stems.filter(
      (stem) =>
        !stem.muted &&
        !(stem.activeIntervals && stem.activeIntervals.length === 0),
    );
    if (activeStems.length === 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "All stems are muted; unmute at least one stem to render a mix.",
        false,
      );
    }

    const stemRows = await prisma.stem.findMany({
      where: { id: { in: activeStems.map((stem) => stem.stemId) } },
      select: {
        id: true,
        uri: true,
        data: true,
        isEncrypted: true,
        encryptionMetadata: true,
      },
    });
    const rowsById = new Map(stemRows.map((row) => [row.id, row]));
    const missing = activeStems.filter((stem) => !rowsById.has(stem.stemId));
    if (missing.length > 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        `Stems not found: ${missing.map((stem) => stem.stemId).join(", ")}`,
        false,
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), "remix-mix-"));
    try {
      const ffmpegInputs: StemMixFfmpegInput[] = [];
      for (const stem of activeStems) {
        const row = rowsById.get(stem.stemId)!;
        const audio = await this.loadStemAudio(row, authorization);
        if (!audio) {
          throw new RemixGenerationProviderError(
            "invalid_input",
            `Audio for stem ${stem.stemId} is unavailable.`,
            false,
          );
        }
        const inputPath = join(workDir, `stem-${ffmpegInputs.length}.audio`);
        await writeFile(inputPath, audio);
        ffmpegInputs.push({
          path: inputPath,
          gainDb: stem.gainDb ?? 0,
          activeIntervals: stem.activeIntervals ?? null,
          fxStemId: stem.stemId,
        });
      }
      for (const input of additionalInputs) {
        const inputPath = join(
          workDir,
          `input-${ffmpegInputs.length}${extensionForMimeType(input.mimeType)}`,
        );
        await writeFile(inputPath, input.buffer);
        ffmpegInputs.push({
          path: inputPath,
          gainDb: input.gainDb ?? 0,
          aiLayer: true,
        });
      }

      const outputPath = join(workDir, "mix.mp3");
      let ffmpegFx: StemMixFfmpegFx | undefined;
      if (fx) {
        // #1897: the reverb IR is code-generated (deterministic, unlicensed)
        // and only written when some input actually sends to the bus.
        const needsImpulse = stemMixReverbSends(ffmpegInputs, fx.effects).some(
          (wet) => wet > 0,
        );
        const impulsePath = needsImpulse
          ? join(workDir, "reverb-ir.wav")
          : null;
        if (impulsePath) await writeImpulseWav(impulsePath);
        ffmpegFx = {
          effects: fx.effects,
          bpm: fx.bpm,
          impulsePath,
          ...(needsImpulse
            ? { afirOptions: await resolveAfirUnityGainOptions(this.logger) }
            : {}),
        };
      }
      const args = buildStemMixFfmpegArgs(ffmpegInputs, outputPath, ffmpegFx);
      const started = Date.now();
      try {
        await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`ffmpeg mix failed for ${label}: ${message}`);
        throw new RemixGenerationProviderError(
          "provider_unavailable",
          "The stems could not be mixed. Please try again later.",
          true,
        );
      }
      this.logger.log(
        `[mix] ${label}: mixed ${ffmpegInputs.length} stems in ${Date.now() - started}ms`,
      );

      const buffer = await readFile(outputPath);
      const metadata = renderMetadata(
        ffmpegInputs.length,
        activeStems.length,
        fx,
      );
      return stemOnly
        ? {
            buffer,
            mimeType: REMIX_RENDER_AUDIO_POLICY.outputMimeType,
            stemCount: activeStems.length,
            renderMetadata: metadata,
          }
        : {
            buffer,
            mimeType: REMIX_RENDER_AUDIO_POLICY.outputMimeType,
            inputCount: ffmpegInputs.length,
            renderMetadata: metadata,
          };
    } finally {
      // Plaintext for encrypted stems lives only here; deletion must run on
      // every success/failure path. Log (never silently swallow) a cleanup
      // failure so a leaking-disk condition is observable. The dir path carries
      // no secret — only the random mkdtemp suffix.
      await rm(workDir, { recursive: true, force: true }).catch((error) => {
        this.logger.warn(
          `Failed to remove remix render temp dir ${workDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }

  /**
   * Returns plaintext audio for one active stem (#1214).
   *
   * Stored bytes in fetch order: DB bytes, then the configured storage
   * provider. Local path containment belongs to LocalStorageProvider so local
   * and GCS/IPFS reads share one boundary instead of duplicating URI parsing.
   *
   * For `isEncrypted` rows the loaded bytes are ciphertext: they are decrypted
   * in memory through the strict render boundary only after the stem is
   * confirmed authorized for this render. We never return ciphertext as audio,
   * and never write plaintext anywhere except the caller's temp dir.
   */
  private async loadStemAudio(
    row: {
      id: string;
      uri: string;
      data: Buffer | Uint8Array | null;
      isEncrypted: boolean;
      encryptionMetadata: string | null;
    },
    authorization: StemRenderAuthorization,
  ): Promise<Buffer | null> {
    const raw = await this.loadStoredBytes(row);
    if (!raw) {
      return null;
    }
    if (!row.isEncrypted) {
      return raw;
    }

    // Defense in depth: only decrypt stems the worker re-confirmed as eligible
    // for this owned project. An encrypted stem outside that set must never be
    // decrypted, even though the arrangement comes from the owned project.
    if (!authorization.authorizedStemIds.has(row.id)) {
      this.logger.warn(
        `Refusing to decrypt unauthorized encrypted stem for project ${authorization.remixProjectId}`,
      );
      throw new RemixGenerationProviderError(
        "invalid_input",
        "A source stem is no longer authorized for this remix render.",
        false,
      );
    }

    const internalAuthSig = {
      // Sentinel + internal purpose: the AES provider grants access only when
      // INTERNAL_SERVICE_KEY matches (SBPR-004 / #1214). No user signature.
      address: "0x0000000000000000000000000000000000000000",
      sig: "remix-render-authorized",
      signedMessage: "Remix render decryption authorization",
      internalKey: process.env.INTERNAL_SERVICE_KEY,
    };

    try {
      const plaintext = await this.encryptionService.decryptForRender(
        raw,
        row.encryptionMetadata ?? "",
        internalAuthSig,
      );
      if (!plaintext || plaintext.length === 0) {
        return null;
      }
      return plaintext;
    } catch (error) {
      throw this.mapDecryptError(error, row.id);
    }
  }

  private async loadStoredBytes(row: {
    id: string;
    uri: string;
    data: Buffer | Uint8Array | null;
  }): Promise<Buffer | null> {
    if (row.data && row.data.length > 0) {
      return Buffer.from(row.data);
    }
    try {
      const audio = await this.storageProvider.download(row.uri);
      return audio && audio.length > 0 ? audio : null;
    } catch {
      // Do not log provider messages: they can contain bucket names, local
      // paths, signed URLs, or other storage internals.
      this.logger.warn(`Storage download failed for stem ${row.id}`);
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        `Stored audio for stem ${row.id} could not be loaded. Please try again later.`,
        true,
      );
    }
  }

  /**
   * Translate strict render-decryption failures into safe provider errors.
   * The reason codes carry no secrets; the user-facing messages never name
   * keys, metadata, URIs, or provider internals.
   */
  private mapDecryptError(
    error: unknown,
    stemId: string,
  ): RemixGenerationProviderError {
    if (error instanceof RenderDecryptionError) {
      switch (error.reason) {
        case "unauthorized":
          return new RemixGenerationProviderError(
            "invalid_input",
            "A source stem is no longer authorized for this remix render.",
            false,
          );
        case "invalid_metadata":
          return new RemixGenerationProviderError(
            "invalid_input",
            `Source audio for stem ${stemId} could not be prepared for rendering.`,
            false,
          );
        case "encryption_disabled":
        case "decryption_failed":
        default:
          // Opaque + retryable: distinguishing a transient key/provider fault
          // from corrupt ciphertext here would leak internals.
          this.logger.warn(
            `Render decryption failed for stem ${stemId}: ${error.reason}`,
          );
          return new RemixGenerationProviderError(
            "provider_unavailable",
            `Source audio for stem ${stemId} could not be prepared for rendering. Please try again later.`,
            true,
          );
      }
    }
    if (error instanceof RemixGenerationProviderError) {
      return error;
    }
    this.logger.warn(`Unexpected render decryption error for stem ${stemId}`);
    return new RemixGenerationProviderError(
      "provider_unavailable",
      `Source audio for stem ${stemId} could not be prepared for rendering. Please try again later.`,
      true,
    );
  }
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") return ".mp3";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/flac") return ".flac";
  return ".audio";
}
