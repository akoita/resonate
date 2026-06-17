import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { StorageProvider } from "../storage/storage_provider";
import {
  estimateRemixGenerationCostUsd,
  REMIX_GENERATION_DEFAULT_DURATION_SECONDS,
  RemixGenerationProviderError,
  type RemixGenerationInput,
  type RemixGenerationJob,
  type RemixGenerationProvider,
} from "./remix-generation.provider";
import { type StemAudioMixer } from "./stem-audio-mixer";

/**
 * Audio-conditioned remix provider (#1182 slice 4) — the first provider that
 * lets the model actually *hear* the licensed source. It mixes the project's
 * unmuted stems (the user's arrangement) and sends that audio plus the prompt
 * to the self-hosted Stable Audio 3 worker, which returns a variation/
 * extension that stays recognizable as the source (adopt-gate #1193, defaults
 * cfg≈7 / init_noise_level≈0.2 / steps=25).
 *
 * Output is draft-quality, not master-quality (the spike's verdict); the
 * honest grounding label is wired in slice 5 (#1207). Behind the master gate
 * + provider-kind selection, default off.
 */
@Injectable()
export class AudioConditionedRemixGenerationProvider
  implements RemixGenerationProvider
{
  private readonly logger = new Logger(
    AudioConditionedRemixGenerationProvider.name,
  );

  constructor(
    private readonly mixer: StemAudioMixer,
    private readonly storageProvider: StorageProvider,
  ) {}

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
    if (input.mode === "stem_mix") {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "Stem-mix drafts are arranged in the studio; AI generation applies to variation and extension modes.",
        false,
      );
    }
    const userPrompt = input.prompt?.trim();
    if (!userPrompt) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "A prompt is required for AI remix generation in this mode.",
        false,
      );
    }
    if (!input.stemArrangement || input.stemArrangement.length === 0) {
      throw new RemixGenerationProviderError(
        "invalid_input",
        "Audio-conditioned generation needs the project's stems to condition on.",
        false,
      );
    }

    // Condition on exactly what the user arranged. The mixer rejects encrypted
    // stems with invalid_input (shared deferral with stem_mix, #1189).
    const mixed = await this.mixer.mixUnmutedStems(
      input.stemArrangement,
      input.provenance.remixProjectId,
    );

    const durationSeconds =
      input.constraints.durationSeconds ??
      REMIX_GENERATION_DEFAULT_DURATION_SECONDS;
    const config = readWorkerConfig();
    const jobId = randomUUID();

    const generated = await this.callWorker({
      config,
      audio: mixed.buffer,
      audioMimeType: mixed.mimeType,
      prompt: userPrompt,
      durationSeconds,
      projectId: input.provenance.remixProjectId,
    });

    const filename = `remix-draft-${input.provenance.remixProjectId}-${jobId}.wav`;
    let outputUri: string;
    try {
      const stored = await this.storageProvider.upload(
        generated.audio,
        filename,
        generated.mimeType,
      );
      outputUri = stored.uri;
    } catch (error) {
      this.logger.error(
        `Remix draft storage write failed for project ${input.provenance.remixProjectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "The generated draft could not be stored. Please try again.",
        true,
      );
    }

    return {
      provider: `stable-audio-3-${config.model}`,
      jobId,
      estimatedCostUsd: estimateRemixGenerationCostUsd(durationSeconds),
      outputMetadata: {
        outputUri,
        mimeType: generated.mimeType,
        // Stable Audio 3 is self-hosted and does not embed SynthID.
        synthIdPresent: false,
        seed: generated.seed,
        sampleRate: generated.sampleRate,
      },
    };
  }

  private async callWorker(args: {
    config: WorkerConfig;
    audio: Buffer;
    audioMimeType: string;
    prompt: string;
    durationSeconds: number;
    projectId: string;
  }): Promise<{
    audio: Buffer;
    mimeType: string;
    seed: number | null;
    sampleRate: number | null;
  }> {
    const { config } = args;
    const form = new FormData();
    form.append(
      "file",
      // Copy into a plain Uint8Array: Node's Buffer is backed by a (possibly
      // shared) ArrayBufferLike that doesn't satisfy the Blob part type.
      new Blob([new Uint8Array(args.audio)], { type: args.audioMimeType }),
      "source.mp3",
    );
    form.append("prompt", args.prompt);
    form.append("cfg_scale", String(config.cfgScale));
    form.append("init_noise_level", String(config.noiseLevel));
    form.append("steps", String(config.steps));
    form.append("duration", String(args.durationSeconds));
    form.append("model", config.model);

    let response: Response;
    try {
      response = await fetch(`${config.workerUrl}/generate`, {
        method: "POST",
        body: form,
        // Generous: absorbs the scale-to-zero cold start (~4 min model load)
        // plus generation. The job is already async/queued (#1167).
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      // Network failure or timeout (incl. cold-start overrun): retryable.
      this.logger.error(
        `Audio worker request failed for project ${args.projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "The remix generation service is unavailable right now. Try again in a few minutes.",
        true,
      );
    }

    if (!response.ok) {
      const detail = await safeReadText(response);
      // 4xx = the model rejected this request (e.g. unusable prompt/audio):
      // not retryable. 5xx = transient service fault: retryable.
      const clientError = response.status >= 400 && response.status < 500;
      this.logger.error(
        `Audio worker returned ${response.status} for project ${args.projectId}: ${detail}`,
      );
      throw new RemixGenerationProviderError(
        clientError ? "provider_rejected" : "provider_unavailable",
        clientError
          ? "The generation service rejected this remix. Adjust the prompt or stems and try again."
          : "The remix generation service failed. Please try again later.",
        !clientError,
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? "audio/wav";
    return {
      audio,
      mimeType,
      seed: parseIntHeader(response.headers.get("x-seed")),
      sampleRate: parseIntHeader(response.headers.get("x-sample-rate")),
    };
  }
}

type WorkerConfig = {
  workerUrl: string;
  cfgScale: number;
  noiseLevel: number;
  steps: number;
  model: string;
  timeoutMs: number;
};

/**
 * Worker connection + generation knobs from env, defaulting to the values the
 * #1193 spike validated (cfg 7 / noise 0.2 / steps 25, medium model). Per-env
 * tuning needs no code or image change.
 */
function readWorkerConfig(): WorkerConfig {
  return {
    workerUrl: process.env.REMIX_AUDIO_WORKER_URL ?? "http://localhost:8000",
    cfgScale: numberEnv(process.env.REMIX_AUDIO_CFG_SCALE, 7),
    noiseLevel: numberEnv(process.env.REMIX_AUDIO_NOISE_LEVEL, 0.2),
    steps: numberEnv(process.env.REMIX_AUDIO_STEPS, 25),
    model: process.env.REMIX_AUDIO_MODEL ?? "medium",
    timeoutMs: numberEnv(process.env.REMIX_AUDIO_TIMEOUT_MS, 360_000),
  };
}

function numberEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntHeader(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
