/**
 * Remix render watermarking (#2573): config, token, args and the embedder's
 * process boundary. The embedder runs a stand-in shell script instead of
 * audiowmark, so the test needs no audiowmark build; the real binary is
 * exercised in remix-stem-audio-mixer.integration.spec.ts when present.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildAudiowmarkAddArgs,
  newRemixWatermarkToken,
  readRemixWatermarkConfig,
  REMIX_WATERMARK_DEFAULT_STRENGTH,
  RemixWatermarkEmbedder,
} from "../modules/remix/remix-watermark";
import { remixWatermarkStemLicenses } from "../modules/remix/remix-watermark-record";
import {
  buildMasterEncodeArgs,
  buildStemMixFfmpegArgs,
  buildStemTapEncodeArgs,
} from "../modules/remix/stem-audio-mixer";

const KEY = "key 00112233445566778899aabbccddeeff";

describe("readRemixWatermarkConfig", () => {
  const warn = jest.fn();
  beforeEach(() => warn.mockReset());

  it("is off without a key: there is no default key", () => {
    expect(readRemixWatermarkConfig({}, { warn })).toBeNull();
    expect(readRemixWatermarkConfig({ REMIX_WATERMARK_KEY: "  " }, { warn })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads the key, key id, default strength and binary", () => {
    expect(
      readRemixWatermarkConfig(
        { REMIX_WATERMARK_KEY: KEY, REMIX_WATERMARK_KEY_ID: "staging-2026-11" },
        { warn },
      ),
    ).toEqual({
      key: KEY,
      keyId: "staging-2026-11",
      strength: REMIX_WATERMARK_DEFAULT_STRENGTH,
      binary: "audiowmark",
    });
    expect(REMIX_WATERMARK_DEFAULT_STRENGTH).toBe(15);
  });

  it("accepts a key file with a name line, a strength and a binary path", () => {
    expect(
      readRemixWatermarkConfig(
        {
          REMIX_WATERMARK_KEY: `# name staging\n${KEY}\n`,
          REMIX_WATERMARK_KEY_ID: "k1",
          REMIX_WATERMARK_STRENGTH: "10",
          REMIX_WATERMARK_BIN: "/usr/local/bin/audiowmark",
        },
        { warn },
      ),
    ).toMatchObject({ keyId: "k1", strength: 10, binary: "/usr/local/bin/audiowmark" });
  });

  it("stays off, with a warning that never prints the key, for a malformed key or no key id", () => {
    expect(
      readRemixWatermarkConfig(
        { REMIX_WATERMARK_KEY: "not-a-key", REMIX_WATERMARK_KEY_ID: "k1" },
        { warn },
      ),
    ).toBeNull();
    expect(readRemixWatermarkConfig({ REMIX_WATERMARK_KEY: KEY }, { warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    for (const [message] of warn.mock.calls) {
      expect(message).not.toContain("00112233");
      expect(message).not.toContain("not-a-key");
    }
  });

  it("falls back to the default strength for an invalid value", () => {
    for (const value of ["abc", "0", "-3", "80"]) {
      expect(
        readRemixWatermarkConfig(
          { REMIX_WATERMARK_KEY: KEY, REMIX_WATERMARK_KEY_ID: "k1", REMIX_WATERMARK_STRENGTH: value },
          { warn },
        )?.strength,
      ).toBe(15);
    }
  });
});

describe("watermark token and args", () => {
  it("makes an opaque 128-bit token, different every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newRemixWatermarkToken()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("builds an execFile argument array for audiowmark add", () => {
    expect(buildAudiowmarkAddArgs("/k/key", 15, "/w/in.wav", "/w/out.wav", "ab".repeat(16))).toEqual([
      "add",
      "--key",
      "/k/key",
      "--strength",
      "15",
      "/w/in.wav",
      "/w/out.wav",
      "ab".repeat(16),
    ]);
  });

  it("writes a float PCM master for a .wav output and keeps the MP3 args unchanged", () => {
    const input = [{ path: "/w/a.wav", gainDb: 0, activeIntervals: null }];
    const mp3 = buildStemMixFfmpegArgs(input as never, "/w/mix.mp3");
    const wav = buildStemMixFfmpegArgs(input as never, "/w/mix.wav");
    expect(mp3).toEqual(
      expect.arrayContaining(["-codec:a", "libmp3lame", "-b:a", "320k", "/w/mix.mp3"]),
    );
    expect(wav).toEqual(expect.arrayContaining(["-codec:a", "pcm_f32le", "/w/mix.wav"]));
    expect(wav).not.toContain("libmp3lame");
    // Everything but the codec and path is the same graph.
    const strip = (args: string[]) =>
      args.filter(
        (arg) => !["libmp3lame", "-b:a", "320k", "pcm_f32le", "/w/mix.mp3", "/w/mix.wav"].includes(arg),
      );
    expect(strip(wav)).toEqual(strip(mp3));
  });

  it("encodes the watermarked master and stems with the render policies", () => {
    expect(buildMasterEncodeArgs("/w/mix.wm.wav", "/w/mix.mp3")).toEqual(
      expect.arrayContaining(["-i", "/w/mix.wm.wav", "libmp3lame", "320k", "48000", "/w/mix.mp3"]),
    );
    expect(buildStemTapEncodeArgs("/w/s.wav", "/w/s.flac")).toEqual(
      expect.arrayContaining(["-i", "/w/s.wav", "flac", "s32", "24", "48000", "/w/s.flac"]),
    );
  });
});

describe("RemixWatermarkEmbedder", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wm-spec-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** A stand-in for audiowmark: records its args and copies input to output. */
  function fakeBinary(exitCode = 0): string {
    const path = join(dir, "fake-audiowmark.sh");
    writeFileSync(
      path,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncp "$3" "${dir}/key-copy.txt"\n` +
        (exitCode === 0 ? `cp "$6" "$7"\n` : `echo boom >&2\nexit ${exitCode}\n`),
    );
    chmodSync(path, 0o755);
    return path;
  }

  it("runs the binary with a 0600 key file and the token", async () => {
    const input = join(dir, "in.wav");
    writeFileSync(input, "pcm");
    const embedder = new RemixWatermarkEmbedder({
      key: KEY,
      keyId: "k1",
      strength: 15,
      binary: fakeBinary(),
    });
    const token = newRemixWatermarkToken();
    await embedder.embed(input, join(dir, "out.wav"), token);
    await embedder.embed(input, join(dir, "out2.wav"), token);

    expect(readFileSync(join(dir, "out.wav"), "utf8")).toBe("pcm");
    const args = readFileSync(join(dir, "args.txt"), "utf8").trim().split("\n");
    expect(args[0]).toBe("add");
    expect(args.slice(4)).toEqual(["15", input, join(dir, "out2.wav"), token]);
    expect(readFileSync(join(dir, "key-copy.txt"), "utf8")).toBe(`${KEY}\n`);
    const keyPath = args[2];
    expect(keyPath).not.toContain(dir);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    rmSync(join(keyPath, ".."), { recursive: true, force: true });
  });

  it("rejects when the binary fails, so the caller ships the render unwatermarked", async () => {
    const input = join(dir, "in.wav");
    writeFileSync(input, "pcm");
    const embedder = new RemixWatermarkEmbedder({
      key: KEY,
      keyId: "k1",
      strength: 15,
      binary: fakeBinary(3),
    });
    await expect(embedder.embed(input, join(dir, "out.wav"), newRemixWatermarkToken())).rejects.toThrow();
  });

  it("rejects when the binary is missing", async () => {
    const embedder = new RemixWatermarkEmbedder({
      key: KEY,
      keyId: "k1",
      strength: 15,
      binary: join(dir, "no-such-binary"),
    });
    await expect(
      embedder.embed(join(dir, "in.wav"), join(dir, "out.wav"), newRemixWatermarkToken()),
    ).rejects.toThrow();
  });
});

describe("remixWatermarkStemLicenses", () => {
  it("records the licence basis and the purchase trail per rendered stem", () => {
    expect(
      remixWatermarkStemLicenses(
        [
          { stemId: "own", licensed: true, exportLicensed: true },
          { stemId: "com", licensed: true, exportLicensed: true },
          { stemId: "rmx", licensed: true, exportLicensed: false },
          { stemId: "x402", licensed: true, exportLicensed: false },
          { stemId: "none", licensed: false, exportLicensed: false },
        ],
        [
          { id: "p1", stemId: "com", licenseType: "commercial" },
          { id: "p2", stemId: "rmx", licenseType: "remix" },
        ],
        [{ id: "s1", stemId: "x402", licenseType: "remix" }],
      ),
    ).toEqual([
      { stemId: "own", basis: "owner", stemPurchaseIds: [], x402SettlementIds: [] },
      { stemId: "com", basis: "commercial", stemPurchaseIds: ["p1"], x402SettlementIds: [] },
      { stemId: "rmx", basis: "remix", stemPurchaseIds: ["p2"], x402SettlementIds: [] },
      { stemId: "x402", basis: "remix", stemPurchaseIds: [], x402SettlementIds: ["s1"] },
      { stemId: "none", basis: "none", stemPurchaseIds: [], x402SettlementIds: [] },
    ]);
  });
});
