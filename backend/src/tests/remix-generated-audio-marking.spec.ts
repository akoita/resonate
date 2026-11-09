/**
 * #2602: generated audio is marked on every output path, or refuses to ship.
 * Unit level: no database. The mixer cases run real ffmpeg with a stand-in
 * for audiowmark; the render graph itself is covered by
 * remix-stem-audio-mixer.integration.spec.ts.
 */
import { execFileSync } from "child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Logger } from "@nestjs/common";
import type { EncryptionService } from "../modules/encryption/encryption.service";
import type { StorageProvider } from "../modules/storage/storage_provider";
import { GENERATED_AUDIO_OUTPUT_PATHS } from "../modules/remix/generated-audio-outputs";
import { buildPartEncodeArgs } from "../modules/remix/remix-part-conform";
import {
  assertDraftMarkedForRelease,
  exportAiDisclosure,
} from "../modules/remix/remix-project.service";
import {
  AI_GENERATED_AUDIO_TAGS,
  aiGeneratedTagArgs,
  draftMarkState,
  embedWatermarkWithRetry,
  REMIX_WATERMARK_EMBED_ATTEMPTS,
  RemixWatermarkEmbedder,
  UNMARKED_DRAFT_REFUSAL,
  UNMARKED_GENERATED_AUDIO_MESSAGE,
} from "../modules/remix/remix-watermark";
import { buildMasterEncodeArgs, FfmpegStemAudioMixer } from "../modules/remix/stem-audio-mixer";

const KEY = "key 00112233445566778899aabbccddeeff";
const KEYED = { REMIX_WATERMARK_KEY: KEY, REMIX_WATERMARK_KEY_ID: "k1" } as NodeJS.ProcessEnv;
const EMBEDDED = { status: "embedded", scheme: "audiowmark", schemeVersion: "0.6.5", strength: 15, keyId: "k1" };
const RENDER = { schemaVersion: "remix-render/v1", inputCount: 2 };

describe("embedWatermarkWithRetry (#2602)", () => {
  it("tries again after a failure and reports the retried error", async () => {
    const embed = jest.fn().mockRejectedValueOnce(new Error("first")).mockResolvedValue(undefined);
    const retried: number[] = [];
    await embedWatermarkWithRetry({ embed }, "in", "out", "t", (_error, attempt) => retried.push(attempt));
    expect(embed).toHaveBeenCalledTimes(2);
    expect(retried).toEqual([1]);
  });

  it("gives up after the configured attempts and rethrows the last error", async () => {
    const embed = jest.fn().mockRejectedValue(new Error("down"));
    await expect(embedWatermarkWithRetry({ embed }, "in", "out", "t")).rejects.toThrow("down");
    expect(embed).toHaveBeenCalledTimes(REMIX_WATERMARK_EMBED_ATTEMPTS);
  });
});

describe("draftMarkState (#2602)", () => {
  it("has nothing to mark without generated audio", () => {
    expect(draftMarkState({ aiGenerated: false, renderMetadata: RENDER })).toBe("not_generated");
  });

  it("reads a rendered draft's own mark, never a layer's provider mark", () => {
    expect(
      draftMarkState({ aiGenerated: true, renderMetadata: { ...RENDER, watermark: EMBEDDED } }),
    ).toBe("marked");
    expect(
      draftMarkState({
        aiGenerated: true,
        renderMetadata: { ...RENDER, watermark: { status: "none", reason: "embed_failed" } },
        output: { synthIdPresent: true },
      }),
    ).toBe("unmarked");
    // Rendered before watermarking existed.
    expect(
      draftMarkState({ aiGenerated: true, renderMetadata: RENDER, output: { synthIdPresent: true } }),
    ).toBe("unmarked");
  });

  it("reads a whole-model draft's mark from its output", () => {
    expect(draftMarkState({ aiGenerated: true, output: { watermark: EMBEDDED } })).toBe("marked");
    expect(draftMarkState({ aiGenerated: true, output: { synthIdPresent: true } })).toBe("provider_marked");
    expect(draftMarkState({ aiGenerated: true, output: { synthIdPresent: false } })).toBe("unmarked");
    expect(draftMarkState({ aiGenerated: true })).toBe("unmarked");
  });
});

describe("assertDraftMarkedForRelease (#2602)", () => {
  const draft = (overrides: Record<string, unknown>) => ({
    status: "completed",
    grounding: "stem_audio",
    output: { outputUri: "local://x.mp3", synthIdPresent: false },
    ...overrides,
  });
  const refusal = (metadata: unknown, env = KEYED) => {
    try {
      assertDraftMarkedForRelease(metadata, env);
      return null;
    } catch (error) {
      return (error as { getResponse(): unknown }).getResponse();
    }
  };

  it("refuses an unmarked AI draft when a key is configured", () => {
    expect(refusal(draft({ grounding: "audio_conditioned" }))).toEqual(UNMARKED_DRAFT_REFUSAL);
    expect(
      refusal(draft({ grounding: "stem_plus_ai", renderMetadata: { ...RENDER, watermark: { status: "none", reason: "embed_failed" } } })),
    ).toMatchObject({ code: "draft_unmarked" });
  });

  it("treats a stem render with an AI part as generated audio", () => {
    const parts = [{ partId: "p1", role: "bass", takeId: "t1", provider: null, model: null, promptVersion: "v1", conformVersion: null, bars: 4, gainDb: 0 }];
    expect(
      refusal(draft({ renderMetadata: { ...RENDER, parts, watermark: { status: "none", reason: "embed_failed" } } })),
    ).toMatchObject({ code: "draft_unmarked" });
    expect(refusal(draft({ renderMetadata: { ...RENDER, parts, watermark: EMBEDDED } }))).toBeNull();
  });

  it("lets marked and provider-marked AI drafts through", () => {
    expect(refusal(draft({ grounding: "stem_plus_ai", renderMetadata: { ...RENDER, watermark: EMBEDDED } }))).toBeNull();
    expect(
      refusal(draft({ grounding: "audio_conditioned", output: { outputUri: "local://x.wav", watermark: EMBEDDED } })),
    ).toBeNull();
    expect(
      refusal(draft({ grounding: "prompt_only", output: { outputUri: "local://x.mp3", synthIdPresent: true } })),
    ).toBeNull();
  });

  it("keeps the stem-only path open even when its mark failed", () => {
    expect(
      refusal(draft({ renderMetadata: { ...RENDER, watermark: { status: "none", reason: "embed_failed" } } })),
    ).toBeNull();
  });

  it("refuses nothing where no key is configured", () => {
    expect(refusal(draft({ grounding: "audio_conditioned" }), {} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("exportAiDisclosure (#2602)", () => {
  it("says an AI draft is generated, how it is marked, and its source type", () => {
    expect(
      exportAiDisclosure({ grounding: "stem_plus_ai", renderMetadata: { ...RENDER, watermark: EMBEDDED } }),
    ).toEqual({
      aiGenerated: true,
      grounding: "stem_plus_ai",
      marking: "marked",
      digitalSourceType: AI_GENERATED_AUDIO_TAGS.DIGITAL_SOURCE_TYPE,
    });
  });

  it("says a stem render is not generated and never carries the token", () => {
    const disclosure = exportAiDisclosure({ grounding: "stem_audio", renderMetadata: { ...RENDER, watermark: EMBEDDED } });
    expect(disclosure).toEqual({ aiGenerated: false, grounding: "stem_audio", marking: "not_generated" });
  });
});

describe("AI-generated file tags (#2602)", () => {
  it("tags every AI part take", () => {
    const args = buildPartEncodeArgs("in.raw", "out.flac");
    for (const pair of aiGeneratedTagArgs().filter((arg) => arg !== "-metadata")) {
      expect(args[args.indexOf(pair) - 1]).toBe("-metadata");
    }
    expect(args).toContain("AI_GENERATED=true");
    expect(args.indexOf("-map_metadata")).toBeLessThan(args.indexOf("AI_GENERATED=true"));
  });

  it("tags a marked master only when the render contains generated audio", () => {
    expect(buildMasterEncodeArgs("in.wav", "out.mp3")).not.toContain("AI_GENERATED=true");
    const tagged = buildMasterEncodeArgs("in.wav", "out.mp3", true);
    expect(tagged).toContain("AI_GENERATED=true");
    expect(tagged).toContain(`DIGITAL_SOURCE_TYPE=${AI_GENERATED_AUDIO_TAGS.DIGITAL_SOURCE_TYPE}`);
    expect(tagged[tagged.length - 1]).toBe("out.mp3");
  });
});

describe("markGeneratedAudio (#2602)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wm-mark-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  /** A stand-in for audiowmark add: fails `failures` times, then copies input to output. */
  function fakeAudiowmark(failures: number): string {
    const path = join(dir, "fake.sh");
    writeFileSync(
      path,
      `#!/bin/sh\nn=$(cat "${dir}/calls" 2>/dev/null || echo 0)\nn=$((n+1))\necho $n > "${dir}/calls"\n` +
        `if [ $n -le ${failures} ]; then echo boom >&2; exit 1; fi\ncp "$6" "$7"\n`,
    );
    chmodSync(path, 0o755);
    return path;
  }
  const mixerWith = (binary: string | null) =>
    new FfmpegStemAudioMixer(
      {} as unknown as StorageProvider,
      {} as unknown as EncryptionService,
      binary ? new RemixWatermarkEmbedder({ key: KEY, keyId: "k1", strength: 15, binary }) : undefined,
    );
  const calls = () => Number(readFileSync(join(dir, "calls"), "utf8").trim());
  const markTempDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith("remix-mark-"));
  function tone(): Buffer {
    const path = join(dir, "tone.flac");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=2", path]);
    return readFileSync(path);
  }

  it("returns a marked WAV and its token, whatever format the model returned", async () => {
    const before = markTempDirs();
    const marked = await mixerWith(fakeAudiowmark(0)).markGeneratedAudio(tone(), "audio/flac", "p1");
    expect(marked.mimeType).toBe("audio/wav");
    expect(marked.buffer.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(marked.metadata).toEqual(EMBEDDED);
    expect(marked.watermark).toMatchObject({ token: expect.stringMatching(/^[0-9a-f]{32}$/), keyId: "k1" });
    expect(JSON.stringify(marked.metadata)).not.toContain(marked.watermark!.token);
    expect(markTempDirs()).toEqual(before);
  });

  it("retries once before giving up", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const marked = await mixerWith(fakeAudiowmark(1)).markGeneratedAudio(tone(), "audio/flac", "p1");
    expect(marked.metadata.status).toBe("embedded");
    expect(calls()).toBe(2);
  });

  it("fails the draft when the mark cannot be embedded, without logging the token", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const before = markTempDirs();
    await expect(
      mixerWith(fakeAudiowmark(99)).markGeneratedAudio(tone(), "audio/flac", "p1"),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      message: UNMARKED_GENERATED_AUDIO_MESSAGE,
    });
    expect(calls()).toBe(REMIX_WATERMARK_EMBED_ATTEMPTS);
    const logged = error.mock.calls.map(([message]) => String(message)).join("\n");
    expect(logged).toContain("could not be marked");
    expect(logged).not.toMatch(/[0-9a-f]{32}/);
    expect(markTempDirs()).toEqual(before);
  });

  it("returns the audio untouched where no key is configured", async () => {
    const audio = Buffer.from("model-output");
    const marked = await mixerWith(null).markGeneratedAudio(audio, "audio/wav", "p1");
    expect(marked.buffer).toBe(audio);
    expect(marked.metadata).toEqual({ status: "none", reason: "no_key" });
    expect(marked.watermark).toBeUndefined();
  });
});

describe("generated-audio output inventory (#2602)", () => {
  const modulesDir = join(__dirname, "..", "modules");
  const sourceFiles = (dir: string): string[] =>
    readdirSync(join(modulesDir, dir))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"))
      .map((name) => `${dir}/${name}`);
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

  it("lists every storage write in the remix and generation modules", () => {
    const listed = new Map<string, number>();
    for (const path of GENERATED_AUDIO_OUTPUT_PATHS) {
      listed.set(path.source, (listed.get(path.source) ?? 0) + path.uploads);
    }
    const found = new Map<string, number>();
    for (const file of [...sourceFiles("remix"), ...sourceFiles("generation")]) {
      const uploads = count(readFileSync(join(modulesDir, file), "utf8"), /\.upload\(/g);
      if (uploads > 0) found.set(file, uploads);
    }
    // A new upload in these modules must be added to the inventory, with how
    // it is marked, before it can ship.
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries([...listed].filter(([, uploads]) => uploads > 0)),
    );
  });

  it("lists every audio response the remix controller sends", () => {
    const controller = readFileSync(join(modulesDir, "remix/remix.controller.ts"), "utf8");
    const responses = count(controller, /this\.send(AudioResponse|DownloadResponse|StreamedDownload)\(/g);
    const listed = GENERATED_AUDIO_OUTPUT_PATHS.reduce((sum, path) => sum + path.routes.length, 0);
    expect(responses).toBe(listed);
  });

  it("has unique ids and a row for each in the feature page", () => {
    const ids = GENERATED_AUDIO_OUTPUT_PATHS.map((path) => path.id);
    expect(new Set(ids).size).toBe(ids.length);
    const page = readFileSync(
      join(__dirname, "..", "..", "..", "docs", "features", "remix_studio.md"),
      "utf8",
    );
    for (const id of ids) expect(page).toContain(`| \`${id}\` |`);
  });

  it("never lets a path that can hold generated audio go without a marking", () => {
    for (const path of GENERATED_AUDIO_OUTPUT_PATHS) {
      expect(path.how.length).toBeGreaterThan(20);
      expect([
        "remix_mark_required",
        "provider_mark",
        "file_tags",
        "inherits_draft_mark",
        "studio_playback",
      ]).toContain(path.marking);
    }
  });
});
