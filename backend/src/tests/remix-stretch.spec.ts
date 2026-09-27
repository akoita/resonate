/**
 * Time-stretch engine (#1898) — pure unit tests against the vendored WASM.
 *
 * The parity block regenerates the fixture's documented input and asserts
 * every case's output length and sha256 (little-endian float32, L then R);
 * the web lib replays the same fixture, so Node and the browser are pinned to
 * the same bytes. The render's file stage (16-bit, TPDF-dithered) quantises
 * only after the engine, so its bytes derive from the same float output.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertRemixStretchWasm,
  createPcm16Quantizer,
  createStretchEngine,
  minimumInputLength,
  REMIX_STRETCH_DRIVER,
  REMIX_STRETCH_ENGINE,
  REMIX_STRETCH_WASM_SHA256,
  remixStretchWasmPath,
  StreamingStretch,
  stretchOffline,
  stretchOutputLength,
  stretchRawFileToWav,
  stretchRawFileToWavInWorker,
} from "../modules/remix/remix-stretch";
import {
  dominantHz,
  makeTestSignal,
  sha256Of,
} from "./remix-stretch-test-signals";

type StretchFixture = {
  schemaVersion: string;
  engine: {
    package: string;
    version: string;
    wasmSha256: string;
    wasmBytes: number;
  };
  driver: { chunk: number; preset: string; tonalityHz: number; seed: number };
  input: { sampleRate: number; seconds: number; sha256: string };
  cases: Array<{
    tempo: number;
    semitones: number;
    outputLength: number;
    sha256: string;
    first: number[];
  }>;
};

const fixture: StretchFixture = JSON.parse(
  readFileSync(
    join(__dirname, "../modules/remix/remix-stretch-v1.parity.json"),
    "utf8",
  ),
);

/** Stream `input` through StreamingStretch in the given push sizes. */
async function streamed(
  input: Float32Array[],
  sampleRate: number,
  params: { tempo: number; semitones: number },
  pushSizes: (index: number) => number,
): Promise<{ out: Float32Array[]; maxEmit: number }> {
  const api = await createStretchEngine();
  const parts: Float32Array[][] = input.map(() => []);
  let maxEmit = 0;
  const stretch = new StreamingStretch(api, {
    channelCount: input.length,
    sampleRate,
    inputLength: input[0].length,
    ...params,
    sink: (channels, frames) => {
      maxEmit = Math.max(maxEmit, frames);
      channels.forEach((channel, c) => parts[c].push(channel.slice(0, frames)));
    },
  });
  let position = 0;
  for (let step = 0; position < input[0].length; step += 1) {
    const size = Math.min(pushSizes(step), input[0].length - position);
    stretch.push(input.map((channel) => channel.subarray(position, position + size)));
    position += size;
  }
  stretch.finish();
  const out = parts.map((chunks) => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  });
  expect(out[0].length).toBe(stretch.outputLength);
  return { out, maxEmit };
}

describe("remix-stretch/v1 parity fixture (#1898)", () => {
  const input = makeTestSignal(fixture.input.sampleRate, fixture.input.seconds);

  it("pins the engine, the WASM and the driver", () => {
    expect(fixture.schemaVersion).toBe("remix-stretch/v1");
    expect(`${fixture.engine.package}@${fixture.engine.version}`).toBe(
      REMIX_STRETCH_ENGINE,
    );
    expect(fixture.engine.wasmSha256).toBe(REMIX_STRETCH_WASM_SHA256);
    const bytes = readFileSync(remixStretchWasmPath());
    expect(bytes.length).toBe(fixture.engine.wasmBytes);
    expect(() => assertRemixStretchWasm(bytes)).not.toThrow();
    expect(fixture.driver).toEqual({ ...REMIX_STRETCH_DRIVER });
  });

  it("regenerates the documented input", () => {
    expect(sha256Of(input)).toBe(fixture.input.sha256);
  });

  it.each(fixture.cases)(
    "tempo $tempo, semitones $semitones",
    async ({ tempo, semitones, outputLength, sha256, first }) => {
      const api = await createStretchEngine();
      const { out } = stretchOffline(api, input, fixture.input.sampleRate, {
        tempo,
        semitones,
      });
      expect(out[0].length).toBe(outputLength);
      expect(out[1].length).toBe(outputLength);
      expect(stretchOutputLength(input[0].length, tempo)).toBe(outputLength);
      expect(Array.from(out[0].slice(4800, 4804))).toEqual(first);
      expect(sha256Of(out)).toBe(sha256);
    },
  );

  it.each(fixture.cases)(
    "streams byte-identically: tempo $tempo, semitones $semitones",
    async ({ tempo, semitones, sha256 }) => {
      const { out } = await streamed(
        input,
        fixture.input.sampleRate,
        { tempo, semitones },
        (step) => [1000, 4096, 12345, 1, 77777][step % 5],
      );
      expect(sha256Of(out)).toBe(sha256);
    },
  );

  it("streams byte-identically for whole-input and tiny pushes", async () => {
    const reference = fixture.cases[2];
    const whole = await streamed(
      input,
      fixture.input.sampleRate,
      reference,
      () => input[0].length,
    );
    expect(sha256Of(whole.out)).toBe(reference.sha256);
    const tiny = await streamed(input, fixture.input.sampleRate, reference, () => 333);
    expect(sha256Of(tiny.out)).toBe(reference.sha256);
    // Bounded windows: never more than one output chunk per emission.
    expect(tiny.maxEmit).toBeLessThanOrEqual(REMIX_STRETCH_DRIVER.chunk);
  });

  it("is deterministic across fresh engine instances", async () => {
    const reference = fixture.cases[3];
    for (let run = 0; run < 2; run += 1) {
      const api = await createStretchEngine();
      const { out } = stretchOffline(api, input, fixture.input.sampleRate, reference);
      expect(sha256Of(out)).toBe(reference.sha256);
    }
  });
});

describe("time-stretch engine guards (#1898)", () => {
  it("refuses a WASM with another hash", async () => {
    const bytes = new Uint8Array(readFileSync(remixStretchWasmPath()));
    bytes[bytes.length - 1] ^= 1;
    expect(() => assertRemixStretchWasm(bytes)).toThrow(/integrity/);
    await expect(createStretchEngine(bytes)).rejects.toThrow(/integrity/);
  });

  it("refuses audio shorter than twice the output latency", async () => {
    const api = await createStretchEngine();
    const short = [new Float32Array(1000), new Float32Array(1000)];
    expect(() => stretchOffline(api, short, 48_000, { tempo: 0.85 })).toThrow(
      /too short/,
    );
  });

  it("streams input shorter than the minimum zero-padded, trimmed to round(len/tempo)", async () => {
    const tempo = 0.85;
    const probe = await createStretchEngine();
    const { outLat } = stretchOffline(probe, makeTestSignal(48_000, 1), 48_000, { tempo });
    const minimum = minimumInputLength(outLat, tempo);
    expect(stretchOutputLength(minimum, tempo)).toBeGreaterThanOrEqual(2 * outLat);
    expect(stretchOutputLength(minimum - 1, tempo)).toBeLessThan(2 * outLat);

    const short = makeTestSignal(48_000, 1).map((channel) => channel.slice(0, 1000));
    const collected: Float32Array[][] = [[], []];
    const api = await createStretchEngine();
    const stretch = new StreamingStretch(api, {
      channelCount: 2,
      sampleRate: 48_000,
      inputLength: 1000,
      tempo,
      padToMinimum: true,
      sink: (channels, frames) =>
        channels.forEach((channel, c) => collected[c].push(channel.slice(0, frames))),
    });
    stretch.push(short);
    stretch.finish();
    expect(stretch.outputLength).toBe(Math.round(1000 / tempo));
    const out = collected.map((parts) => {
      const merged = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
      }
      return merged;
    });
    expect(out[0].length).toBe(Math.round(1000 / tempo));
    // Exactly the offline stretch of the zero-padded input, trimmed.
    const padded = short.map((channel) => {
      const buffer = new Float32Array(minimum);
      buffer.set(channel);
      return buffer;
    });
    const reference = stretchOffline(await createStretchEngine(), padded, 48_000, {
      tempo,
    }).out.map((channel) => channel.slice(0, out[0].length));
    expect(sha256Of(out)).toBe(sha256Of(reference));
  });

  it("leaves inputs at the minimum unpadded, and streams empty input as empty", async () => {
    const tempo = 1.2;
    const probe = await createStretchEngine();
    const { outLat } = stretchOffline(probe, makeTestSignal(48_000, 1), 48_000, { tempo });
    const minimum = minimumInputLength(outLat, tempo);
    const input = makeTestSignal(48_000, 1).map((channel) => channel.slice(0, minimum));
    const reference = stretchOffline(await createStretchEngine(), input, 48_000, { tempo });
    const parts: Float32Array[][] = [[], []];
    const stretch = new StreamingStretch(await createStretchEngine(), {
      channelCount: 2,
      sampleRate: 48_000,
      inputLength: minimum,
      tempo,
      padToMinimum: true,
      sink: (channels, frames) =>
        channels.forEach((channel, c) => parts[c].push(channel.slice(0, frames))),
    });
    stretch.push(input);
    stretch.finish();
    const joined = parts.map((chunks) => {
      const merged = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return merged;
    });
    expect(sha256Of(joined)).toBe(sha256Of(reference.out));

    let frames = 0;
    const empty = new StreamingStretch(await createStretchEngine(), {
      channelCount: 2,
      sampleRate: 48_000,
      inputLength: 0,
      tempo,
      padToMinimum: true,
      sink: (_channels, n) => {
        frames += n;
      },
    });
    empty.finish();
    expect(empty.outputLength).toBe(0);
    expect(frames).toBe(0);
  });

  it("rejects more input than declared and an early finish", async () => {
    const api = await createStretchEngine();
    const stretch = new StreamingStretch(api, {
      channelCount: 1,
      sampleRate: 48_000,
      inputLength: 48_000,
      tempo: 0.9,
      sink: () => undefined,
    });
    stretch.push([new Float32Array(40_000)]);
    expect(() => stretch.push([new Float32Array(10_000)])).toThrow(/declared/);
    expect(() => stretch.finish()).toThrow(/ended at 40000/);
  });
});

describe("pitch and tempo sanity on a 440 Hz sine (#1898)", () => {
  const sampleRate = 48_000;
  const sine = makeTestSignal(sampleRate, 10, "sine");
  const cents = (measured: number, expected: number) =>
    1200 * Math.log2(measured / expected);

  it("tempo 0.85 keeps 440 Hz and lengthens by 1/0.85", async () => {
    const api = await createStretchEngine();
    const { out } = stretchOffline(api, sine, sampleRate, { tempo: 0.85 });
    expect(out[0].length).toBe(Math.round(sine[0].length / 0.85));
    const hz = dominantHz(out[0], sampleRate, (out[0].length >> 1) - 32768);
    expect(Math.abs(cents(hz, 440))).toBeLessThanOrEqual(5);
  });

  it("+2 semitones lands on 493.9 Hz within 5 cents, same length", async () => {
    const api = await createStretchEngine();
    const { out } = stretchOffline(api, sine, sampleRate, { semitones: 2 });
    expect(out[0].length).toBe(sine[0].length);
    const hz = dominantHz(out[0], sampleRate, (out[0].length >> 1) - 32768);
    expect(Math.abs(cents(hz, 440 * 2 ** (2 / 12)))).toBeLessThanOrEqual(5);
  });
});

describe("16-bit TPDF quantiser (#1898)", () => {
  const signal = makeTestSignal(48_000, 1);

  it("is deterministic per seed and independent of chunking", () => {
    const whole = Buffer.alloc(signal[0].length * 4);
    createPcm16Quantizer(7)(signal, signal[0].length, whole);
    const again = Buffer.alloc(whole.length);
    createPcm16Quantizer(7)(signal, signal[0].length, again);
    expect(again.equals(whole)).toBe(true);

    const chunked = Buffer.alloc(whole.length);
    const quantize = createPcm16Quantizer(7);
    for (let offset = 0; offset < signal[0].length; offset += 777) {
      const frames = Math.min(777, signal[0].length - offset);
      const part = Buffer.alloc(frames * 4);
      quantize(signal.map((channel) => channel.subarray(offset, offset + frames)), frames, part);
      part.copy(chunked, offset * 4);
    }
    expect(chunked.equals(whole)).toBe(true);

    const other = Buffer.alloc(whole.length);
    createPcm16Quantizer(8)(signal, signal[0].length, other);
    expect(other.equals(whole)).toBe(false);
  });

  it("adds at most ±1 LSB triangular noise and clips at full scale", () => {
    // Half scale: the test signal itself peaks above full scale.
    const quiet = signal.map((channel) => channel.map((value) => value * 0.5));
    const out = Buffer.alloc(quiet[0].length * 4);
    createPcm16Quantizer(1)(quiet, quiet[0].length, out);
    let sum = 0;
    let worst = 0;
    for (let i = 0; i < quiet[0].length; i += 1) {
      for (let c = 0; c < 2; c += 1) {
        const error = out.readInt16LE((i * 2 + c) * 2) - quiet[c][i] * 32768;
        worst = Math.max(worst, Math.abs(error));
        sum += error;
      }
    }
    // Round (±0.5) plus triangular dither (±1).
    expect(worst).toBeLessThanOrEqual(1.5);
    // Zero-mean noise.
    expect(Math.abs(sum / (quiet[0].length * 2))).toBeLessThan(0.05);

    const loud = [new Float32Array([2, -2, 1, -1, 0.99999])];
    const clipped = Buffer.alloc(10);
    createPcm16Quantizer(1)(loud, 5, clipped);
    expect(clipped.readInt16LE(0)).toBe(32767);
    expect(clipped.readInt16LE(2)).toBe(-32768);
    expect(clipped.readInt16LE(4)).toBe(32767);
    expect(clipped.readInt16LE(6)).toBeGreaterThanOrEqual(-32768);
    expect(clipped.readInt16LE(6)).toBeLessThanOrEqual(-32767);
  });
});

describe("file stretch stage (#1898)", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "remix-stretch-spec-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** Quantise planar stereo to raw s16le (what ffmpeg -f s16le emits). */
  function writeRawS16(path: string, channels: Float32Array[]): Float32Array[] {
    const frames = channels[0].length;
    const bytes = Buffer.alloc(frames * 4);
    const decoded = channels.map(() => new Float32Array(frames));
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < 2; c += 1) {
        const q = Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32768)));
        bytes.writeInt16LE(q, (i * 2 + c) * 2);
        decoded[c][i] = q / 32768;
      }
    }
    writeFileSync(path, bytes);
    return decoded;
  }

  /** The engine's float output of the same input, then the same quantiser. */
  async function expectedData(
    decoded: Float32Array[],
    params: { tempo: number; semitones: number },
    seed: number,
  ): Promise<Buffer> {
    const { out } = stretchOffline(await createStretchEngine(), decoded, 48_000, params);
    const data = Buffer.alloc(out[0].length * 4);
    createPcm16Quantizer(seed)(out, out[0].length, data);
    return data;
  }

  it.each([
    ["in-process", stretchRawFileToWav],
    ["in a worker thread", (job: Parameters<typeof stretchRawFileToWav>[0]) =>
      stretchRawFileToWavInWorker(job)],
  ] as const)(
    "writes the engine output as a deterministic dithered 16-bit WAV (%s)",
    async (_label, run) => {
      const reference = fixture.cases[2];
      const raw = join(workDir, "in.s16");
      const decoded = writeRawS16(raw, makeTestSignal(48_000, fixture.input.seconds));
      const job = {
        inputPath: raw,
        outputPath: join(workDir, "out.wav"),
        tempo: reference.tempo,
        semitones: reference.semitones,
        ditherSeed: 42,
      };
      const result = await run(job);
      expect(result.inputFrames).toBe(decoded[0].length);
      expect(result.outputFrames).toBe(reference.outputLength);
      const wav = readFileSync(job.outputPath);
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt16LE(20)).toBe(1);
      expect(wav.readUInt16LE(22)).toBe(2);
      expect(wav.readUInt32LE(24)).toBe(48_000);
      expect(wav.readUInt16LE(34)).toBe(16);
      expect(wav.readUInt32LE(40)).toBe(reference.outputLength * 4);
      expect(wav.length).toBe(44 + reference.outputLength * 4);
      expect(
        wav.subarray(44).equals(await expectedData(decoded, reference, 42)),
      ).toBe(true);

      // Same job again → the same bytes; another seed → other dither.
      const again = { ...job, outputPath: join(workDir, "again.wav") };
      await run(again);
      expect(readFileSync(again.outputPath).equals(wav)).toBe(true);
      const reseeded = { ...job, outputPath: join(workDir, "seed.wav"), ditherSeed: 43 };
      await run(reseeded);
      expect(readFileSync(reseeded.outputPath).equals(wav)).toBe(false);
    },
    120_000,
  );

  it("pads a stem shorter than the engine minimum and trims to round(len/tempo)", async () => {
    const raw = join(workDir, "short.s16");
    writeRawS16(raw, makeTestSignal(48_000, 1).map((channel) => channel.slice(0, 1000)));
    const outputPath = join(workDir, "short.wav");
    const result = await stretchRawFileToWavInWorker({
      inputPath: raw,
      outputPath,
      tempo: 0.85,
      semitones: 2,
      ditherSeed: 1,
    });
    expect(result.outputFrames).toBe(Math.round(1000 / 0.85));
    const wav = readFileSync(outputPath);
    expect(wav.readUInt32LE(40)).toBe(Math.round(1000 / 0.85) * 4);
    expect(wav.length).toBe(44 + Math.round(1000 / 0.85) * 4);
  }, 60_000);

  it("surfaces a worker failure as a rejection", async () => {
    await expect(
      stretchRawFileToWavInWorker({
        inputPath: join(workDir, "missing.s16"),
        outputPath: join(workDir, "out.wav"),
        tempo: 0.9,
        semitones: 0,
        ditherSeed: 1,
      }),
    ).rejects.toThrow(/ENOENT/);
  }, 60_000);
});
