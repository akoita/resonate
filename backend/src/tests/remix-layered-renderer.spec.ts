import { FfmpegLayeredRemixRenderer } from "../modules/remix/remix-layered-renderer";
import { RemixGenerationProviderError } from "../modules/remix/remix-generation.provider";
import type { StemAudioMixer } from "../modules/remix/stem-audio-mixer";
import type { StorageProvider } from "../modules/storage/storage_provider";

describe("FfmpegLayeredRemixRenderer (#1209)", () => {
  const mixer = {
    mixUnmutedStems: jest.fn(),
    mixAudioBuffers: jest.fn(),
  };
  const storageProvider = {
    upload: jest.fn(),
    download: jest.fn(),
    downloadRange: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(() => {
    mixer.mixUnmutedStems.mockReset().mockResolvedValue({
      buffer: Buffer.from("source-mix"),
      mimeType: "audio/mpeg",
      stemCount: 1,
    });
    mixer.mixAudioBuffers.mockReset().mockResolvedValue({
      buffer: Buffer.from("layered-mix"),
      mimeType: "audio/mpeg",
      inputCount: 2,
    });
    storageProvider.download.mockReset().mockResolvedValue(Buffer.from("layer"));
    storageProvider.upload.mockReset().mockResolvedValue({
      uri: "local://remix-draft-layered.mp3",
      provider: "local",
    });
  });

  const renderer = () =>
    new FfmpegLayeredRemixRenderer(
      mixer as unknown as StemAudioMixer,
      storageProvider as unknown as StorageProvider,
    );

  it("mixes arranged stems and the generated layer into one stored draft", async () => {
    const job = await renderer().render({
      remixProjectId: "project-1",
      stems: [{ stemId: "stem-1", gainDb: 0, muted: false }],
      layer: {
        provider: "lyria-3-pro-preview",
        jobId: "layer-job",
        prompt: "add piano",
        constraints: { durationSeconds: 60 },
        estimatedCostUsd: 0.12,
        output: {
          outputUri: "local://layer.wav",
          mimeType: "audio/wav",
          synthIdPresent: true,
          seed: 123,
          sampleRate: 48000,
        },
      },
    });

    expect(mixer.mixUnmutedStems).toHaveBeenCalledWith(
      [{ stemId: "stem-1", gainDb: 0, muted: false }],
      "project-1",
    );
    expect(storageProvider.download).toHaveBeenCalledWith("local://layer.wav");
    expect(mixer.mixAudioBuffers).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          buffer: Buffer.from("source-mix"),
          mimeType: "audio/mpeg",
          label: "source-stems",
        }),
        expect.objectContaining({
          buffer: Buffer.from("layer"),
          mimeType: "audio/wav",
          label: "generated-layer",
        }),
      ],
      "project-1",
    );
    expect(storageProvider.upload).toHaveBeenCalledWith(
      Buffer.from("layered-mix"),
      expect.stringMatching(/^remix-draft-project-1-.+\.mp3$/),
      "audio/mpeg",
    );
    expect(job).toEqual(
      expect.objectContaining({
        provider: "stem-plus-ai-layered-render",
        estimatedCostUsd: 0.12,
        sourceArrangement: [{ stemId: "stem-1", gainDb: 0, muted: false }],
        generatedLayers: [
          expect.objectContaining({
            kind: "generated_layer",
            provider: "lyria-3-pro-preview",
            output: expect.objectContaining({ outputUri: "local://layer.wav" }),
          }),
        ],
        outputMetadata: expect.objectContaining({
          outputUri: "local://remix-draft-layered.mp3",
          mimeType: "audio/mpeg",
          synthIdPresent: true,
          seed: 123,
        }),
      }),
    );
  });

  it("normalizes a missing layer URI as provider_unavailable", async () => {
    await expect(
      renderer().render({
        remixProjectId: "project-1",
        stems: [],
        layer: {
          provider: "lyria",
          jobId: "layer-job",
          prompt: null,
          constraints: {},
          output: {
            outputUri: null,
            mimeType: null,
            synthIdPresent: null,
            seed: null,
            sampleRate: null,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    } satisfies Partial<RemixGenerationProviderError>);
    expect(mixer.mixUnmutedStems).not.toHaveBeenCalled();
  });
});
