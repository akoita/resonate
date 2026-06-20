import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { StorageProvider } from "../storage/storage_provider";
import { type RemixGenerationJob } from "./remix-generation.provider";
import {
  buildStemMixFfmpegArgs,
  type StemArrangementEntry,
  type StemAudioMixer,
} from "./stem-audio-mixer";

// Re-exported for tests and back-compat: the arg builder moved to the shared
// mixer (#1182 slice 4) alongside the stem-loading/mixing logic.
export { buildStemMixFfmpegArgs };

export const REMIX_STEM_MIX_RENDERER = "REMIX_STEM_MIX_RENDERER";

export type StemMixRenderInput = {
  remixProjectId: string;
  stems: StemArrangementEntry[];
};

/**
 * Renders a stem_mix project's arranged stems into one draft file (#1189,
 * slice 2 of #1182). Pure DSP — no AI, no vendor cost — so it sits outside
 * the REMIX_GENERATION_ENABLED master gate, which exists to gate paid
 * generation. The output literally contains the licensed stem audio.
 *
 * The stem-loading + ffmpeg mixing now lives in the shared StemAudioMixer
 * (#1182 slice 4); this renderer just uploads the mix as the draft.
 */
export interface StemMixRenderer {
  render(input: StemMixRenderInput): Promise<RemixGenerationJob>;
}

@Injectable()
export class FfmpegStemMixRenderer implements StemMixRenderer {
  constructor(
    private readonly mixer: StemAudioMixer,
    private readonly storageProvider: StorageProvider,
  ) {}

  async render(input: StemMixRenderInput): Promise<RemixGenerationJob> {
    const jobId = randomUUID();
    const mixed = await this.mixer.mixUnmutedStems(
      input.stems,
      input.remixProjectId,
    );

    // Flat object name (#1162 review precedent): the local storage provider
    // cannot create subdirectories.
    const filename = `remix-draft-${input.remixProjectId}-${jobId}.mp3`;
    const stored = await this.storageProvider.upload(
      mixed.buffer,
      filename,
      mixed.mimeType,
    );

    return {
      jobId,
      provider: "stem-mix-render",
      estimatedCostUsd: 0,
      sourceArrangement: input.stems,
      renderMetadata: mixed.renderMetadata,
      outputMetadata: {
        outputUri: stored.uri,
        mimeType: mixed.mimeType,
        synthIdPresent: false,
        seed: null,
        sampleRate: mixed.renderMetadata.outputSampleRateHz,
      },
    };
  }
}
