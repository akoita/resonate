import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { StorageProvider } from "../storage/storage_provider";
import {
  RemixGenerationProviderError,
  type RemixGeneratedLayerMetadata,
  type RemixGenerationJob,
  type RemixGenerationOutputMetadata,
  type StemArrangementEntry,
  type StemRenderAuthorization,
} from "./remix-generation.provider";
import { type StemAudioMixer } from "./stem-audio-mixer";
import type { RemixRenderFx } from "./remix-fx";
import type { RemixRenderStructure } from "./remix-structure";
import type { RemixRenderBeat } from "./remix-beat";

export const REMIX_LAYERED_RENDERER = "REMIX_LAYERED_RENDERER";

export type LayeredRemixRenderInput = {
  remixProjectId: string;
  stems: StemArrangementEntry[];
  /** Worker-time render grant (#1214) — gates encrypted source decryption. */
  authorization: StemRenderAuthorization;
  /** Project effects recipe + grid tempo (#1897); absent = no effects. */
  fx?: RemixRenderFx;
  /**
   * Structure blocks + timeline (#1899); absent = the original order. Only
   * the source stems are restructured — the generated layer is not.
   */
  structure?: RemixRenderStructure;
  /**
   * Beat maker recipe + bar grid + timeline (#1902); absent = no beat. The
   * beat is mixed in the same final graph as the stems and the layer.
   */
  beat?: RemixRenderBeat;
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
    const layerInputs = [
      {
        buffer: layerBytes,
        mimeType: input.layer.output.mimeType ?? "application/octet-stream",
        gainDb: 0,
        label: "generated-layer",
      },
    ];
    // Effects (#1897) apply in the same final graph: the layer follows the
    // varispeed and the master chain, but gets no per-stem fx.
    const mixed = input.beat
      ? await this.mixer.mixUnmutedStemsWithAudioBuffers(
          input.stems,
          layerInputs,
          input.authorization,
          input.fx,
          input.structure,
          input.beat,
        )
      : input.structure
      ? await this.mixer.mixUnmutedStemsWithAudioBuffers(
          input.stems,
          layerInputs,
          input.authorization,
          input.fx,
          input.structure,
        )
      : input.fx
      ? await this.mixer.mixUnmutedStemsWithAudioBuffers(
          input.stems,
          layerInputs,
          input.authorization,
          input.fx,
        )
      : await this.mixer.mixUnmutedStemsWithAudioBuffers(
          input.stems,
          layerInputs,
          input.authorization,
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
