import { Injectable, Logger } from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";
import { randomUUID } from "crypto";
import { StorageProvider } from "../storage/storage_provider";
import {
  estimateRemixGenerationCostUsd,
  REMIX_GENERATION_DEFAULT_DURATION_SECONDS,
  RemixGenerationProviderError,
  type RemixGenerationInput,
  type RemixGenerationJob,
  type RemixGenerationProvider,
  type StemRenderAuthorization,
  stemTransformPromptLead,
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
 * honest audio_conditioned grounding label is emitted by the project service
 * (#1207). Behind the master gate + provider-kind selection, default off.
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
    authorization: StemRenderAuthorization,
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

    const durationSeconds =
      input.constraints.durationSeconds ??
      REMIX_GENERATION_DEFAULT_DURATION_SECONDS;
    const config = readWorkerConfig();
    const jobId = randomUUID();

    // Condition on exactly what the user arranged. The shared mixer decrypts
    // any authorized encrypted source stems in memory (#1214) before the mix
    // is sent to the worker; ciphertext never leaves the backend.
    const mixed = await this.mixer.mixUnmutedStems(
      input.stemArrangement,
      authorization,
    );

    const generated = await this.callWorker({
      config,
      audio: mixed.buffer,
      audioMimeType: mixed.mimeType,
      // Targeted transforms (#1316) lead with the role-scoped instruction so
      // the conditioned model is asked for exactly one operation.
      prompt: input.stemTransform
        ? stemTransformPromptLead(input.stemTransform, userPrompt)
        : userPrompt,
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

    // The deployed worker is a private Cloud Run service: the invoker IAM
    // grant alone is not enough — the caller must attach an identity token
    // minted for the worker's audience. Locally (no ADC / localhost worker)
    // minting fails and we fall back to an unauthenticated call.
    const headers: Record<string, string> = {};
    const idToken = await this.mintWorkerIdToken(config.workerUrl);
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${config.workerUrl}/generate`, {
        method: "POST",
        body: form,
        headers,
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
      this.logger.error(
        `Audio worker returned ${response.status} for project ${args.projectId}: ${detail}`,
      );
      // 401/403 are auth/config faults between the backend and the worker —
      // never the user's prompt. Surface them as service-unavailable so the
      // user isn't told to "adjust the prompt" for an IAM problem.
      const authError = response.status === 401 || response.status === 403;
      // Other 4xx = the model rejected this request (e.g. unusable
      // prompt/audio): not retryable. 5xx = transient service fault: retryable.
      const clientError =
        !authError && response.status >= 400 && response.status < 500;
      throw new RemixGenerationProviderError(
        clientError ? "provider_rejected" : "provider_unavailable",
        clientError
          ? "The generation service rejected this remix. Adjust the prompt or stems and try again."
          : "The remix generation service is unavailable right now. Try again in a few minutes.",
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

  private googleAuth: GoogleAuth | null = null;
  private idTokenUnavailableLogged = false;

  /**
   * Mint an identity token for the worker's audience (Cloud Run
   * service-to-service auth). Returns null when Application Default
   * Credentials cannot mint one — the local-dev worker on localhost accepts
   * unauthenticated calls, so that path stays functional.
   */
  private async mintWorkerIdToken(workerUrl: string): Promise<string | null> {
    try {
      const audience = new URL(workerUrl).origin;
      this.googleAuth ??= new GoogleAuth();
      const client = await this.googleAuth.getIdTokenClient(audience);
      return await client.idTokenProvider.fetchIdToken(audience);
    } catch (error) {
      if (!this.idTokenUnavailableLogged) {
        this.idTokenUnavailableLogged = true;
        this.logger.warn(
          `No identity token for the audio worker (calling unauthenticated; fine for local dev): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return null;
    }
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

const SUPPORTED_AUDIO_WORKER_MODELS = [
  "medium",
  "small-music",
  "small-sfx",
  "medium-base",
  "small-music-base",
  "small-sfx-base",
] as const;

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
    model: modelEnv(process.env.REMIX_AUDIO_MODEL, "medium"),
    timeoutMs: numberEnv(process.env.REMIX_AUDIO_TIMEOUT_MS, 360_000),
  };
}

function modelEnv(raw: string | undefined, fallback: string): string {
  const model = raw?.trim() || fallback;
  if (
    SUPPORTED_AUDIO_WORKER_MODELS.includes(
      model as (typeof SUPPORTED_AUDIO_WORKER_MODELS)[number],
    )
  ) {
    return model;
  }
  throw new RemixGenerationProviderError(
    "provider_unavailable",
    `Unsupported audio worker model "${model}". Supported self-hosted models: ${SUPPORTED_AUDIO_WORKER_MODELS.join(", ")}.`,
    false,
  );
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
