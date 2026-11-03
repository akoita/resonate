import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { StorageProvider } from "../storage/storage_provider";
import {
  type RemixGenerationJob,
  type StemRenderAuthorization,
} from "./remix-generation.provider";
import type { RemixRenderFx } from "./remix-fx";
import type { RemixRenderStructure } from "./remix-structure";
import type { RemixRenderBeat } from "./remix-beat";
import type { RemixRenderParts } from "./remix-parts";
import {
  REMIX_STEM_TAP_AUDIO_POLICY,
  buildStemMixFfmpegArgs,
  type StemArrangementEntry,
  type StemAudioMixer,
  type StemTapSink,
} from "./stem-audio-mixer";
import {
  renderedStemsRecord,
  stemFileName,
  stemTapLabel,
  type RenderedStemFile,
} from "./remix-stems";

// Re-exported for tests and back-compat: the arg builder moved to the shared
// mixer (#1182 slice 4) alongside the stem-loading/mixing logic.
export { buildStemMixFfmpegArgs };

export const REMIX_STEM_MIX_RENDERER = "REMIX_STEM_MIX_RENDERER";

export type StemMixRenderInput = {
  remixProjectId: string;
  stems: StemArrangementEntry[];
  /** Worker-time render grant (#1214) — gates encrypted source decryption. */
  authorization: StemRenderAuthorization;
  /** Project effects recipe + grid tempo (#1897); absent = no effects. */
  fx?: RemixRenderFx;
  /** Structure blocks + timeline (#1899); absent = the original order. */
  structure?: RemixRenderStructure;
  /** Beat maker recipe + bar grid + timeline (#1902); absent = no beat. */
  beat?: RemixRenderBeat;
  /**
   * AI parts + bar grid + timeline (#1901); absent = no parts. Rendering
   * them is free: the takes were already paid for.
   */
  parts?: RemixRenderParts;
  /**
   * #2550: also store each layer as a pre-master 24-bit FLAC stem.
   * `stemLabels` names source stems by project stem id.
   */
  renderStems?: { stemLabels: Record<string, string> };
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
    const stemFiles: RenderedStemFile[] = [];
    const stemTaps: StemTapSink | null = input.renderStems
      ? async (layer, path) => {
          const label = stemTapLabel(layer, input.renderStems!.stemLabels);
          const name = stemFileName(layer.index, label);
          const data = await readFile(path);
          const stored = await this.storageProvider.upload(
            data,
            `remix-stem-${input.remixProjectId}-${jobId}-${name}`,
            REMIX_STEM_TAP_AUDIO_POLICY.mimeType,
          );
          stemFiles.push({
            name,
            kind: layer.kind,
            label,
            ...(layer.stemId ? { stemId: layer.stemId } : {}),
            ...(layer.partRole ? { partRole: layer.partRole } : {}),
            uri: stored.uri,
            bytes: data.length,
          });
        }
      : null;
    const mixed = stemTaps
      ? await this.mixer
          .mixUnmutedStems(
          input.stems,
          input.authorization,
          input.fx,
          input.structure,
          input.beat,
          input.parts,
          { stemTaps },
        )
          .catch(async (error: unknown) => {
            // A failed render keeps no half set of stems.
            await Promise.all(
              stemFiles.map((file) =>
                this.storageProvider.delete(file.uri).catch(() => undefined),
              ),
            );
            throw error;
          })
      : input.parts
      ? await this.mixer.mixUnmutedStems(
          input.stems,
          input.authorization,
          input.fx,
          input.structure,
          input.beat,
          input.parts,
        )
      : input.beat
      ? await this.mixer.mixUnmutedStems(
          input.stems,
          input.authorization,
          input.fx,
          input.structure,
          input.beat,
        )
      : input.structure
      ? await this.mixer.mixUnmutedStems(
          input.stems,
          input.authorization,
          input.fx,
          input.structure,
        )
      : input.fx
      ? await this.mixer.mixUnmutedStems(
          input.stems,
          input.authorization,
          input.fx,
        )
      : await this.mixer.mixUnmutedStems(input.stems, input.authorization);

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
      ...(stemFiles.length > 0
        ? { renderedStems: renderedStemsRecord(stemFiles) }
        : {}),
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
