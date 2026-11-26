/**
 * Listeners hear the streaming rendition (#2661), so generated audio keeps its
 * machine-readable AI tags there: the rendition writes them again for a track
 * disclosed as AI. Runs real ffmpeg when it is installed (CI installs it).
 */
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { transcodeForStreaming } from "../modules/catalog/stream_rendition.service";
import { appendRiffInfoChunk } from "../modules/generation/generation.service";
import {
  AI_GENERATED_AUDIO_TAGS,
  aiGeneratedInfoComment,
  aiGeneratedTagsFor,
  IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA,
} from "../modules/remix/remix-watermark";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ffmpegIt = hasFfmpeg ? it : it.skip;

function silentWav(seconds = 1): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "rend-tags-"));
  try {
    const out = join(dir, "in.wav");
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      "-metadata", "artist=Uploader Name", "-y", out,
    ]);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function probeTags(mp3: Buffer): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "rend-probe-"));
  try {
    const file = join(dir, "out.mp3");
    writeFileSync(file, mp3);
    const json = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", file], {
      encoding: "utf8",
    });
    const tags = (JSON.parse(json).format?.tags ?? {}) as Record<string, string>;
    return Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toUpperCase(), value]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("aiGeneratedTagsFor", () => {
  it("tags fully generated audio with the trained-model source type", () => {
    expect(aiGeneratedTagsFor("ALL")).toEqual([
      "-metadata", "AI_GENERATED=true",
      "-metadata", `DIGITAL_SOURCE_TYPE=${AI_GENERATED_AUDIO_TAGS.DIGITAL_SOURCE_TYPE}`,
    ]);
  });

  it("tags audio with an AI part with the composite source type", () => {
    expect(aiGeneratedTagsFor("PARTLY")).toEqual([
      "-metadata", "AI_GENERATED=true",
      "-metadata", `DIGITAL_SOURCE_TYPE=${IPTC_COMPOSITE_WITH_TRAINED_ALGORITHMIC_MEDIA}`,
    ]);
  });

  it("adds nothing for human-made or undeclared audio", () => {
    expect(aiGeneratedTagsFor("NONE")).toEqual([]);
    expect(aiGeneratedTagsFor("UNDECLARED")).toEqual([]);
    expect(aiGeneratedTagsFor(null)).toEqual([]);
  });
});

describe("streaming rendition AI tags (real ffmpeg)", () => {
  ffmpegIt("writes the AI tags and drops the archive's own tags", async () => {
    const mp3 = await transcodeForStreaming(silentWav(), "audio/wav", aiGeneratedTagsFor("ALL"));
    const tags = probeTags(mp3);
    expect(tags.AI_GENERATED).toBe("true");
    expect(tags.DIGITAL_SOURCE_TYPE).toBe(AI_GENERATED_AUDIO_TAGS.DIGITAL_SOURCE_TYPE);
    expect(tags.ARTIST).toBeUndefined();
  }, 60_000);

  ffmpegIt("writes no AI tags for a human-made track", async () => {
    const tags = probeTags(await transcodeForStreaming(silentWav(), "audio/wav"));
    expect(tags.AI_GENERATED).toBeUndefined();
    expect(tags.ARTIST).toBeUndefined();
  }, 60_000);
});

describe("standalone generation WAV tags", () => {
  it("puts the AI tags in the INFO comment, not the user id", () => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36, 4);
    header.write("WAVE", 8);
    header.write("data", 36);
    header.writeUInt32LE(0, 40);
    const tagged = appendRiffInfoChunk(header, { title: "t", comment: aiGeneratedInfoComment() });
    const text = tagged.toString("latin1");
    expect(text).toContain("ICMT");
    expect(text).toContain("AI_GENERATED=true; DIGITAL_SOURCE_TYPE=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia");
    expect(tagged.readUInt32LE(4)).toBe(tagged.length - 8);
  });
});
