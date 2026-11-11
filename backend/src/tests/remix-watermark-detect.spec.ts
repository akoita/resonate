/**
 * Remix watermark detection (#2575): config, output parsing, args and the
 * detector's process boundary. The process tests run a stand-in script, so
 * they need no audiowmark build. The last block runs the real audiowmark and
 * ffmpeg when both are installed (the backend image has them): a 30-second
 * MP3 excerpt of a marked file, an unmarked clip and a retired key.
 */
import { execFileSync, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildAudiowmarkGetArgs,
  buildDetectDecodeArgs,
  candidatesFromPatterns,
  parseAudiowmarkGetOutput,
  readRemixWatermarkDetectConfig,
  RemixWatermarkDetector,
} from "../modules/remix/remix-watermark-detect";
import { normalizeEvidenceBundleInput } from "../modules/rights/rights-evidence";

const ACTIVE = "key 00112233445566778899aabbccddeeff";
const RETIRED = "key ffeeddccbbaa99887766554433221100";
const TOKEN = "0123456789abcdef0123456789abcdef";

// Real `audiowmark get` output for a 30 s MP3 excerpt of a marked file.
const REAL_OUTPUT = `key detect.key
pattern  0:00 ${TOKEN} 2.062 0.381 CLIP-B
pattern  0:00 92cdc399763478bbf9466d3304906857 0.221 0.784 CLIP-A
pattern  0:05 f1d55cbf2765a5888df3ead93d65fd45 0.154 0.376 A
pattern   all ${TOKEN} 1.900 0.120
`;

describe("readRemixWatermarkDetectConfig", () => {
  const warn = jest.fn();
  beforeEach(() => warn.mockReset());

  it("is off without any key", () => {
    expect(readRemixWatermarkDetectConfig({}, { warn })).toBeNull();
  });

  it("reads the active key alone, and the retired key beside it", () => {
    const env = { REMIX_WATERMARK_KEY: ACTIVE, REMIX_WATERMARK_KEY_ID: "k2" };
    expect(readRemixWatermarkDetectConfig(env, { warn })?.keys).toEqual([
      { key: ACTIVE, keyId: "k2", slot: "active" },
    ]);
    expect(
      readRemixWatermarkDetectConfig(
        { ...env, REMIX_WATERMARK_RETIRED_KEY: RETIRED, REMIX_WATERMARK_RETIRED_KEY_ID: "k1" },
        { warn },
      )?.keys,
    ).toEqual([
      { key: ACTIVE, keyId: "k2", slot: "active" },
      { key: RETIRED, keyId: "k1", slot: "retired" },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("detects with a retired key alone, after the active key is removed", () => {
    expect(
      readRemixWatermarkDetectConfig(
        { REMIX_WATERMARK_RETIRED_KEY: RETIRED, REMIX_WATERMARK_RETIRED_KEY_ID: "k1" },
        { warn },
      )?.keys,
    ).toEqual([{ key: RETIRED, keyId: "k1", slot: "retired" }]);
  });

  it("skips a malformed key or one without an id, with a warning that never prints it", () => {
    expect(
      readRemixWatermarkDetectConfig(
        {
          REMIX_WATERMARK_KEY: ACTIVE,
          REMIX_WATERMARK_KEY_ID: "k2",
          REMIX_WATERMARK_RETIRED_KEY: "not-a-key",
          REMIX_WATERMARK_RETIRED_KEY_ID: "k1",
        },
        { warn },
      )?.keys.map((key) => key.slot),
    ).toEqual(["active"]);
    expect(
      readRemixWatermarkDetectConfig({ REMIX_WATERMARK_RETIRED_KEY: RETIRED }, { warn }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    for (const [message] of warn.mock.calls) {
      expect(message).not.toContain("not-a-key");
      expect(message).not.toContain("ffeeddcc");
    }
  });
});

describe("parseAudiowmarkGetOutput and candidatesFromPatterns", () => {
  it("reads pattern lines and ignores everything else", () => {
    const patterns = parseAudiowmarkGetOutput(REAL_OUTPUT);
    expect(patterns).toHaveLength(4);
    expect(patterns[0]).toEqual({
      position: "0:00",
      payload: TOKEN,
      syncQuality: 2.062,
      decodeError: 0.381,
    });
    expect(parseAudiowmarkGetOutput("key x\npattern 0:00 nothex 1 1\n\n")).toEqual([]);
  });

  it("keeps one candidate per payload with its best-synced figures", () => {
    const candidates = candidatesFromPatterns(
      parseAudiowmarkGetOutput(REAL_OUTPUT),
      { keyId: "k2", slot: "active" },
      "plain",
    );
    expect(candidates).toHaveLength(3);
    expect(candidates.find((candidate) => candidate.payload === TOKEN)).toEqual({
      payload: TOKEN,
      keyId: "k2",
      keySlot: "active",
      stage: "plain",
      occurrences: 2,
      syncQuality: 2.062,
      decodeError: 0.381,
    });
  });
});

describe("detect args", () => {
  it("adds --detect-speed only on the speed stage", () => {
    expect(buildAudiowmarkGetArgs("/k", "/in.wav", "plain")).toEqual(["get", "--key", "/k", "/in.wav"]);
    expect(buildAudiowmarkGetArgs("/k", "/in.wav", "speed")).toEqual([
      "get",
      "--key",
      "/k",
      "--detect-speed",
      "/in.wav",
    ]);
  });

  it("decodes an upload from the local file only, as audio only", () => {
    const args = buildDetectDecodeArgs("/tmp/clip", "/tmp/clip.wav");
    expect(args.slice(args.indexOf("-protocol_whitelist"), args.indexOf("-i"))).toEqual([
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      "mp3,wav,flac,ogg,aac,mov,matroska,aiff",
    ]);
    expect(args).toEqual(expect.arrayContaining(["-nostdin", "-vn", "-t", "600"]));
    expect(args[args.length - 1]).toBe("/tmp/clip.wav");
  });
});

describe("RemixWatermarkDetector (stand-in program)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wmdetect-spec-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("runs once per key, ties each candidate to its key, and removes the key file", async () => {
    // Prints the token only when the key file holds the retired key.
    const bin = join(dir, "fake-audiowmark.sh");
    writeFileSync(
      bin,
      `#!/bin/sh\necho "$@" >> "${dir}/calls"\nif grep -q ffeeddcc "$3"; then echo "pattern 0:00 ${TOKEN} 1.5 0.01 A"; else echo "pattern 0:00 ${"9".repeat(32)} 0.2 0.5 A"; fi\n`,
    );
    chmodSync(bin, 0o755);
    const detector = new RemixWatermarkDetector({
      binary: bin,
      ffmpegBinary: "ffmpeg",
      keys: [
        { key: ACTIVE, keyId: "k2", slot: "active" },
        { key: RETIRED, keyId: "k1", slot: "retired" },
      ],
    });
    const candidates = await detector.candidates(join(dir, "clip.wav"), "speed");
    expect(candidates.map((c) => [c.payload, c.keyId, c.keySlot, c.stage])).toEqual([
      ["9".repeat(32), "k2", "active", "speed"],
      [TOKEN, "k1", "retired", "speed"],
    ]);
    const calls = execFileSync("cat", [join(dir, "calls")]).toString().trim().split("\n");
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain("--detect-speed");
      const keyPath = call.split(" ")[2];
      expect(spawnSync("test", ["-e", keyPath]).status).not.toBe(0);
    }
  });
});

describe("remix_watermark_match evidence", () => {
  it("cannot be submitted by a person, an admin included", () => {
    expect(() =>
      normalizeEvidenceBundleInput({
        subjectType: "dispute",
        subjectId: "d1",
        submittedByRole: "ops",
        purpose: "ops_review",
        evidences: [{ kind: "remix_watermark_match", title: "x", description: "y" }],
      }),
    ).toThrow("recorded by the platform");
  });
});

const realBinary = process.env.REMIX_WATERMARK_BIN?.trim() || "audiowmark";
const haveReal =
  spawnSync(realBinary, ["--version"]).status === 0 &&
  spawnSync("ffmpeg", ["-version"]).status === 0;

(haveReal ? describe : describe.skip)("RemixWatermarkDetector (real audiowmark)", () => {
  let dir: string;
  const detector = (keys: Array<[string, string, "active" | "retired"]>) =>
    new RemixWatermarkDetector({
      binary: realBinary,
      ffmpegBinary: "ffmpeg",
      keys: keys.map(([key, keyId, slot]) => ({ key, keyId, slot })),
    });
  const ffmpeg = (...args: string[]) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wmdetect-real-"));
    ffmpeg(
      "-f", "lavfi", "-i", "anoisesrc=d=60:c=pink:r=44100:a=0.3",
      "-f", "lavfi", "-i", "sine=f=220:d=60",
      "-filter_complex", "amix=inputs=2", "-ac", "2", join(dir, "source.wav"),
    );
    writeFileSync(join(dir, "active.key"), `${ACTIVE}\n`);
    execFileSync(realBinary, [
      "add", "--key", join(dir, "active.key"), "--strength", "15",
      join(dir, "source.wav"), join(dir, "marked.wav"), TOKEN,
    ]);
    // A 30-second MP3 excerpt from the middle of the marked file.
    ffmpeg("-ss", "11", "-t", "30", "-i", join(dir, "marked.wav"), "-b:a", "128k", join(dir, "clip.mp3"));
    ffmpeg("-t", "30", "-i", join(dir, "source.wav"), "-b:a", "128k", join(dir, "unmarked.mp3"));
  }, 120_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const payloads = async (d: RemixWatermarkDetector, clip: string) => {
    const wav = join(dir, `${clip}.decoded.wav`);
    await d.decodeClip(join(dir, clip), wav);
    return d.candidates(wav, "plain");
  };

  it("recovers the token from a 30-second MP3 excerpt", async () => {
    const found = await payloads(detector([[ACTIVE, "k2", "active"]]), "clip.mp3");
    const hit = found.find((candidate) => candidate.payload === TOKEN);
    expect(hit).toMatchObject({ keyId: "k2", keySlot: "active" });
    const best = Math.max(...found.map((candidate) => candidate.syncQuality ?? 0));
    expect(hit?.syncQuality).toBe(best);
  }, 120_000);

  it("does not decode the token from the unmarked clip", async () => {
    const found = await payloads(detector([[ACTIVE, "k2", "active"]]), "unmarked.mp3");
    expect(found.some((candidate) => candidate.payload === TOKEN)).toBe(false);
  }, 120_000);

  it("recovers it with the key in the retired slot, and not with another key", async () => {
    const found = await payloads(
      detector([
        [RETIRED, "k3", "active"],
        [ACTIVE, "k2", "retired"],
      ]),
      "clip.mp3",
    );
    expect(found.filter((candidate) => candidate.payload === TOKEN)).toEqual([
      expect.objectContaining({ keyId: "k2", keySlot: "retired" }),
    ]);
  }, 120_000);

  it("refuses a file that is not one of the allowed audio containers", async () => {
    writeFileSync(join(dir, "playlist"), "#EXTM3U\n#EXTINF:1,\n/etc/passwd\n");
    await expect(
      detector([[ACTIVE, "k2", "active"]]).decodeClip(join(dir, "playlist"), join(dir, "p.wav")),
    ).rejects.toBeDefined();
  }, 60_000);
});
