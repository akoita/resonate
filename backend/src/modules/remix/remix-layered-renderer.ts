import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type RemixGeneratedLayerMetadata,
  type RemixGenerationJob,
  type RemixGenerationOutputMetadata,
  type StemArrangementEntry,
} from "./remix-generation.provider";
import { type StemAudioMixer } from "./stem-audio-mixer";

export const REMIX_LAYERED_RENDERER = "REMIX_LAYERED_RENDERER";

export type LayeredRemixRenderInput = {
  remixProjectId: string;
  stems: StemArrangementEntry[];
  layer: {
    provider: string;
    jobId: string;
    prompt: string | null;
    constraints: Record<string, unknown>;
    output: RemixGenerationOutputMetadata;
    estimatedCostUsd?: number | null;
  };
};

export interface LayeredRemixRenderer {
  render(input: LayeredRemixRenderInput): Promise<RemixGenerationJob>;
}

/**
 * Renders the #1209 path: the arranged licensed stems stay as the backbone,
 * while provider-generated audio is mixed on top as an additive layer.
 */
@Injectable()
export class FfmpegLayeredRemixRenderer implements LayeredRemixRenderer {
  constructor(
    private readonly mixer: StemAudioMixer,
    private readonly storageProvider: StorageProvider,
  ) {}

  async render(input: LayeredRemixRenderInput): Promise<RemixGenerationJob> {
    const layerUri = input.layer.output.outputUri;
    if (!layerUri) {
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "The generated layer did not include audio to mix.",
        true,
      );
    }

    const layerBytes = await this.storageProvider.download(layerUri);
    if (!layerBytes) {
      throw new RemixGenerationProviderError(
        "provider_unavailable",
        "The generated layer audio could not be loaded.",
        true,
      );
    }

    // One final graph: loading the arranged stems and generated layer together
    // avoids the old source-MP3 intermediate, double normalization, and double
    // lossy encoding (#1210).
    const mixed = await this.mixer.mixUnmutedStemsWithAudioBuffers(
      input.stems,
      [
        {
          buffer: layerBytes,
          mimeType: input.layer.output.mimeType ?? "application/octet-stream",
          gainDb: 0,
          label: "generated-layer",
        },
      ],
      input.remixProjectId,
    );

    const jobId = randomUUID();
    const filename = `remix-draft-${input.remixProjectId}-${jobId}.mp3`;
    const stored = await this.storageProvider.upload(
      mixed.buffer,
      filename,
      mixed.mimeType,
    );
    const generatedLayer: RemixGeneratedLayerMetadata = {
      kind: "generated_layer",
      provider: input.layer.provider,
      jobId: input.layer.jobId,
      prompt: input.layer.prompt,
      constraints: input.layer.constraints,
      output: input.layer.output,
    };

    return {
      provider: "stem-plus-ai-layered-render",
      jobId,
      estimatedCostUsd: input.layer.estimatedCostUsd ?? undefined,
      sourceArrangement: input.stems,
      renderMetadata: mixed.renderMetadata,
      generatedLayers: [generatedLayer],
      outputMetadata: {
        outputUri: stored.uri,
        mimeType: mixed.mimeType,
        synthIdPresent: input.layer.output.synthIdPresent,
        seed: input.layer.output.seed,
        sampleRate: mixed.renderMetadata.outputSampleRateHz,
      },
    };
  }
}
