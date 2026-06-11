import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { LyriaClient } from "../generation/lyria.client";
import { StorageProvider } from "../storage/storage_provider";
import {
  estimateRemixGenerationCostUsd,
  REMIX_GENERATION_DEFAULT_DURATION_SECONDS,
  RemixGenerationProviderError,
  type RemixGenerationInput,
  type RemixGenerationJob,
  type RemixGenerationProvider,
} from "./remix-generation.provider";

/**
 * First real remix draft provider (#1162, backlog D2), reusing the catalog
 * Lyria stack. Prompt-based modes only: `variation` and `extension` build a
 * text prompt from the user's prompt plus constraint hints. `stem_mix` is
 * rejected — it needs audio conditioning, and generating unrelated audio
 * from a text prompt would misrepresent the user's mix.
 *
 * Synchronous by design for D2: the request waits for Lyria and the storage
 * write. Queue-backed jobs and retries are backlog D3.
 */
@Injectable()
export class LyriaRemixGenerationProvider implements RemixGenerationProvider {
  private readonly logger = new Logger(LyriaRemixGenerationProvider.name);

  constructor(
    private readonly lyriaClient: LyriaClient,
    private readonly storageProvider: StorageProvider,
  ) {}

  async createRemixDraft(
    input: RemixGenerationInput,
  ): Promise<RemixGenerationJob> {
    // Master gate, identical semantics to the stub: provider kind selects
    // the implementation, REMIX_GENERATION_ENABLED decides whether any
    // generation runs at all (checked per call so tests can toggle it).
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

    const durationSeconds =
      input.constraints.durationSeconds ??
      REMIX_GENERATION_DEFAULT_DURATION_SECONDS;
    const prompt = buildLyriaRemixPrompt({
      mode: input.mode,
      userPrompt,
      bpm: input.constraints.bpm,
      key: input.constraints.key,
    });

    const jobId = randomUUID();
    let result;
    try {
      result = await this.lyriaClient.generate({
        prompt,
        // SupportedGenerationDuration is enforced at the endpoint (#1162);
        // the cast keeps the boundary decoupled from the catalog DTO type.
        durationSeconds: durationSeconds as 30 | 60 | 120 | 180,
      });
    } catch (error) {
      throw normalizeLyriaError(error);
    }

    const extension = extensionForMimeType(result.mimeType);
    // Flat name: the local storage provider writes join(uploadDir, filename)
    // without creating subdirectories, so path separators would ENOENT on
    // local dev. GCS treats the name as an opaque object key either way.
    const filename = `remix-draft-${input.provenance.remixProjectId}-${jobId}.${extension}`;
    let outputUri: string;
    try {
      const stored = await this.storageProvider.upload(
        result.audioBytes,
        filename,
        result.mimeType,
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
      provider: result.provider,
      jobId,
      estimatedCostUsd: estimateRemixGenerationCostUsd(durationSeconds),
      outputMetadata: {
        outputUri,
        mimeType: result.mimeType,
        synthIdPresent: result.synthIdPresent,
        seed: result.seed,
        sampleRate: result.sampleRate,
      },
    };
  }
}

/**
 * Pure prompt construction so mode/constraint phrasing is testable. The user
 * prompt leads; mode and musical constraints are appended as plain hints.
 */
export function buildLyriaRemixPrompt(input: {
  mode: "variation" | "extension";
  userPrompt: string;
  bpm?: number;
  key?: string;
}): string {
  const parts = [
    input.mode === "variation"
      ? `Create a reinterpreted variation of the source arrangement: ${input.userPrompt}`
      : `Extend the source arrangement with a continuation that develops it further: ${input.userPrompt}`,
  ];
  if (input.bpm) parts.push(`Tempo around ${input.bpm} BPM.`);
  if (input.key) parts.push(`In the key of ${input.key}.`);
  return parts.join(" ");
}

/**
 * Vendor errors mapped onto the normalized boundary codes, mirroring the
 * catalog generation stack's categories: safety/prompt rejections are not
 * retryable; quota and transport failures are.
 */
export function normalizeLyriaError(error: unknown): RemixGenerationProviderError {
  if (error instanceof RemixGenerationProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("safety") ||
    normalized.includes("blocked") ||
    normalized.includes("prohibited")
  ) {
    return new RemixGenerationProviderError(
      "provider_rejected",
      "The generation provider rejected this prompt. Adjust the prompt and try again.",
      false,
    );
  }
  if (
    normalized.includes("resource_exhausted") ||
    normalized.includes("429") ||
    normalized.includes("quota")
  ) {
    return new RemixGenerationProviderError(
      "provider_unavailable",
      "The generation provider is rate-limited right now. Try again in a few minutes.",
      true,
    );
  }
  return new RemixGenerationProviderError(
    "provider_unavailable",
    "The remix generation provider failed. Please try again later.",
    true,
  );
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  return "audio";
}
