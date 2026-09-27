/**
 * Remix Studio time-stretch / pitch-shift engine (#1898).
 *
 * The vendored Signalsmith Stretch 1.3.2 WASM (MIT, see NOTICE), driven by our
 * own loader and offline driver — no Web Audio, no npm runtime dependency.
 * The same loader + driver run in the browser preview
 * (web/src/lib/remixStretch.ts); the WASM is scalar-only (no SIMD, threads or
 * FMA), so both produce byte-identical output. The committed fixture
 * `remix-stretch-v1.parity.json` pins the output sha256 of 5 tempo/key cases.
 *
 * Changing ANY driver constant ({@link REMIX_STRETCH_DRIVER}) or the WASM
 * changes every stretched render, so it needs a new engine id + fixture.
 *
 * The module also hosts the render's worker-thread entry: a stem is stretched
 * chunk-streamed from a raw s16le file to a dithered 16-bit WAV in a
 * `worker_threads` worker so the event loop never blocks on DSP.
 */

import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from "fs";
import { resolve } from "path";
import { isMainThread, parentPort, Worker, workerData } from "worker_threads";

export const REMIX_STRETCH_ENGINE = "signalsmith-stretch@1.3.2";
export const REMIX_STRETCH_WASM_FILE = "signalsmith-stretch-1.3.2.wasm";
/** sha256 of the vendored WASM; asserted before every instantiation. */
export const REMIX_STRETCH_WASM_SHA256 =
  "83869197b3c5ebf9fc8c517a1586aef1ecf77404842218d62b9c0e82882d8ca3";
/** Pinned driver parameters (part of the parity contract). */
export const REMIX_STRETCH_DRIVER = Object.freeze({
  /** Fixed output chunk per process() call. */
  chunk: 4096,
  preset: "default" as const,
  /** Tonality limit for the transposition, in Hz. */
  tonalityHz: 8000,
  /** xorshift32 seed replacing the WASM's random_get. */
  seed: 0x5eed,
});
/** The render stretches every input as 48 kHz stereo (16-bit files, float DSP). */
export const REMIX_STRETCH_SAMPLE_RATE = 48_000;
export const REMIX_STRETCH_CHANNELS = 2;

/**
 * Minified emscripten export names of the pinned WASM, in order. A different
 * list means a different build: refuse it.
 */
const EXPECTED_EXPORTS = "e f g h i j k l m n o p q r s t u v w x y";

/** The Signalsmith Stretch C API exported by the WASM. */
export type StretchApi = {
  setBuffers(channels: number, length: number): number;
  blockSamples(): number;
  intervalSamples(): number;
  inputLatency(): number;
  outputLatency(): number;
  reset(): void;
  presetDefault(channels: number, sampleRate: number): void;
  presetCheaper(channels: number, sampleRate: number): void;
  configure(
    channels: number,
    blockSamples: number,
    intervalSamples: number,
    splitComputation: number,
  ): void;
  setTransposeFactor(factor: number, tonalityLimit: number): void;
  setTransposeSemitones(semitones: number, tonalityLimit: number): void;
  setFormantFactor(factor: number, compensatePitch: number): void;
  setFormantSemitones(semitones: number, compensatePitch: number): void;
  setFormantBase(baseFreq: number): void;
  seek(inputSamples: number, playbackRate: number): void;
  process(inputSamples: number, outputSamples: number): void;
  flush(outputSamples: number): void;
  memory: WebAssembly.Memory;
};

/** Audio shorter than twice the engine's output latency cannot be stretched. */
export class StretchTooShortError extends RangeError {
  constructor(readonly inputLength: number) {
    super(`Audio too short to time-stretch (${inputLength} samples).`);
    this.name = "StretchTooShortError";
  }
}

/**
 * What a stretched render records (renderMetadata + publish lineage): the
 * exact engine build and the stage parameters.
 */
export type RemixStretchMetadata = {
  engine: typeof REMIX_STRETCH_ENGINE;
  wasmSha256: typeof REMIX_STRETCH_WASM_SHA256;
  tempo: number;
  semitones: number;
};

export function remixStretchMetadata(plan: {
  tempo: number;
  semitones: number;
}): RemixStretchMetadata {
  return {
    engine: REMIX_STRETCH_ENGINE,
    wasmSha256: REMIX_STRETCH_WASM_SHA256,
    tempo: plan.tempo,
    semitones: plan.semitones,
  };
}

/**
 * Tolerant read of a recorded stretch block (lineage): anything malformed
 * reads as null. The engine id and hash are kept as recorded, so a future
 * engine's drafts stay auditable.
 */
export function readStoredRemixStretch(
  stored: unknown,
): { engine: string; wasmSha256: string; tempo: number; semitones: number } | null {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    return null;
  }
  const value = stored as Record<string, unknown>;
  if (
    typeof value.engine !== "string" ||
    typeof value.wasmSha256 !== "string" ||
    typeof value.tempo !== "number" ||
    !Number.isFinite(value.tempo) ||
    !(value.tempo > 0) ||
    typeof value.semitones !== "number" ||
    !Number.isFinite(value.semitones)
  ) {
    return null;
  }
  return {
    engine: value.engine,
    wasmSha256: value.wasmSha256,
    tempo: value.tempo,
    semitones: value.semitones,
  };
}

export type StretchParams = {
  /** Playback rate: 0.85 = slower (output is 1/0.85 × longer). */
  tempo?: number;
  /** Pitch shift in semitones. */
  semitones?: number;
};

// --- WASM loading -------------------------------------------------------------

/**
 * Where the vendored WASM lives: `backend/assets/wasm/`, three levels above
 * this module both from `src/modules/remix` (ts-node/jest) and from
 * `dist/modules/remix` (the built service; the Dockerfile copies `assets/`
 * next to `dist/`). The cwd candidate covers tools run from `backend/`.
 */
export function remixStretchWasmPath(): string {
  const candidates = [
    resolve(__dirname, "../../../assets/wasm", REMIX_STRETCH_WASM_FILE),
    resolve(process.cwd(), "assets/wasm", REMIX_STRETCH_WASM_FILE),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `The time-stretch engine (${REMIX_STRETCH_WASM_FILE}) is missing from the build.`,
    );
  }
  return found;
}

/** Throws unless `bytes` is the pinned WASM. */
export function assertRemixStretchWasm(bytes: Uint8Array): void {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== REMIX_STRETCH_WASM_SHA256) {
    throw new Error(
      `Time-stretch WASM integrity check failed (sha256 ${digest}).`,
    );
  }
}

let wasmModule: WebAssembly.Module | null = null;

/** The verified, compiled WASM module (read + hashed + compiled once). */
function remixStretchModule(): WebAssembly.Module {
  if (wasmModule) return wasmModule;
  const bytes = readFileSync(remixStretchWasmPath());
  assertRemixStretchWasm(bytes);
  wasmModule = new WebAssembly.Module(bytes);
  return wasmModule;
}

/**
 * Instantiate a fresh engine: the 4 hand-written imports (abort, memcpy,
 * heap growth, and a seeded xorshift32 in place of random_get so every run is
 * deterministic), the export-list assertion, then the C++ constructors.
 *
 * @param wasm verified module bytes (hashed here) or a compiled module;
 *   default = the vendored file.
 */
export async function createStretchEngine(
  wasm?: Uint8Array | WebAssembly.Module,
  { seed = REMIX_STRETCH_DRIVER.seed }: { seed?: number } = {},
): Promise<StretchApi> {
  let compiled: WebAssembly.Module;
  if (wasm === undefined) {
    compiled = remixStretchModule();
  } else if (wasm instanceof WebAssembly.Module) {
    compiled = wasm;
  } else {
    assertRemixStretchWasm(wasm);
    // Copy into a plain ArrayBuffer-backed view (BufferSource).
    compiled = await WebAssembly.compile(new Uint8Array(wasm));
  }
  return instantiateStretch(compiled, seed);
}

type StretchExports = Record<string, unknown> & {
  e: WebAssembly.Memory;
  f: () => void;
};

async function instantiateStretch(
  compiled: WebAssembly.Module,
  seed: number,
): Promise<StretchApi> {
  let ex: StretchExports | null = null;
  let u8: Uint8Array | null = null;
  const memory = () => ex!.e;
  const heap = () =>
    u8 && u8.buffer === memory().buffer
      ? u8
      : (u8 = new Uint8Array(memory().buffer));
  let s = seed >>> 0;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s & 255;
  };
  const imports = {
    a: {
      // __abort_js
      d: () => {
        throw new Error("signalsmith-stretch wasm abort");
      },
      // _emscripten_memcpy_js
      c: (dest: number, src: number, num: number) => {
        heap().copyWithin(dest, src, src + num);
      },
      // _emscripten_resize_heap
      b: (requested: number) => {
        requested >>>= 0;
        const current = memory().buffer.byteLength;
        const target = Math.max(
          requested,
          Math.min(current * 1.5, requested + 100663296),
        );
        const pages = Math.ceil(
          (Math.ceil(target / 65536) * 65536 - current) / 65536,
        );
        try {
          memory().grow(pages);
          return 1;
        } catch {
          return 0;
        }
      },
      // _random_get
      a: (ptr: number, size: number) => {
        const h = heap();
        for (let i = 0; i < size; i += 1) h[ptr + i] = rnd();
        return 0;
      },
    },
  };
  const instance = await WebAssembly.instantiate(compiled, imports);
  ex = instance.exports as unknown as StretchExports;
  const names = Object.keys(ex).join(" ");
  if (names !== EXPECTED_EXPORTS) {
    throw new Error(`Unexpected time-stretch WASM exports: ${names}`);
  }
  ex.f(); // __wasm_call_ctors: constructs the global Stretch (draws the seed)
  const fn = <T>(name: string) => ex![name] as T;
  return {
    setBuffers: fn("h"),
    blockSamples: fn("i"),
    intervalSamples: fn("j"),
    inputLatency: fn("k"),
    outputLatency: fn("l"),
    reset: fn("m"),
    presetDefault: fn("n"),
    presetCheaper: fn("o"),
    configure: fn("p"),
    setTransposeFactor: fn("q"),
    setTransposeSemitones: fn("r"),
    setFormantFactor: fn("s"),
    setFormantSemitones: fn("t"),
    setFormantBase: fn("u"),
    seek: fn("v"),
    process: fn("w"),
    flush: fn("x"),
    memory: ex.e,
  };
}

// --- Drivers ------------------------------------------------------------------

/** Output length of a stretch: round(input / tempo). */
export function stretchOutputLength(inputLength: number, tempo: number): number {
  return Math.round(inputLength / tempo);
}

type PreparedStretch = {
  inLat: number;
  outLat: number;
  bufLen: number;
  base: number;
  /** Input length the engine runs on (≥ the source when padded). */
  engineInputLength: number;
  /** round(engineInputLength / tempo). */
  engineOutputLength: number;
};

/**
 * Smallest input length whose output reaches the engine minimum of twice the
 * output latency: round(n / tempo) ≥ 2·outLat.
 */
export function minimumInputLength(outLat: number, tempo: number): number {
  let n = Math.max(1, Math.ceil(2 * outLat * tempo) - 1);
  while (stretchOutputLength(n, tempo) < 2 * outLat) n += 1;
  return n;
}

/**
 * Configure the engine + buffers exactly as the pinned driver does. Input
 * shorter than the engine minimum throws, or — with `padToMinimum` — runs on
 * the input zero-padded to {@link minimumInputLength} (the caller trims the
 * output back to round(input / tempo)). Padding never applies to inputs at or
 * above the minimum, so their output is unchanged.
 */
function prepareStretch(
  api: StretchApi,
  channelCount: number,
  sampleRate: number,
  inputLength: number,
  tempo: number,
  semitones: number,
  padToMinimum = false,
): PreparedStretch {
  const { chunk, tonalityHz } = REMIX_STRETCH_DRIVER;
  api.presetDefault(channelCount, sampleRate);
  api.setTransposeSemitones(semitones, tonalityHz / sampleRate);
  api.setFormantSemitones(0, 0);
  api.setFormantBase(0);
  const inLat = api.inputLatency();
  const outLat = api.outputLatency();
  let engineInputLength = inputLength;
  if (stretchOutputLength(inputLength, tempo) < outLat * 2) {
    if (!padToMinimum) throw new StretchTooShortError(inputLength);
    engineInputLength = minimumInputLength(outLat, tempo);
  }
  const engineOutputLength = stretchOutputLength(engineInputLength, tempo);
  const maxIn = Math.ceil(chunk * tempo) + 2;
  const bufLen = Math.max(
    maxIn,
    chunk,
    api.blockSamples() + api.intervalSamples(),
    inLat,
    outLat,
  );
  const base = api.setBuffers(channelCount, bufLen);
  return {
    inLat,
    outLat,
    bufLen,
    base,
    engineInputLength,
    engineOutputLength,
  };
}

function validateParams(params: StretchParams): {
  tempo: number;
  semitones: number;
} {
  const tempo = params.tempo ?? 1;
  const semitones = params.semitones ?? 0;
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new RangeError("tempo must be a positive finite number");
  }
  if (!Number.isFinite(semitones)) {
    throw new RangeError("semitones must be finite");
  }
  return { tempo, semitones };
}

/**
 * Whole-buffer offline stretch, equivalent to C++ SignalsmithStretch::exact():
 * output length = round(input / tempo), latency compensated, the start folded
 * back, the tail flushed; fixed 4096-sample output chunks. Faithful port of
 * the #1898 spike driver (the parity reference). `channels` share one length.
 */
export function stretchOffline(
  api: StretchApi,
  channels: Float32Array[],
  sampleRate: number,
  params: StretchParams = {},
): { out: Float32Array[]; inLat: number; outLat: number } {
  const { tempo, semitones } = validateParams(params);
  const { chunk } = REMIX_STRETCH_DRIVER;
  const nCh = channels.length;
  const inLen = channels[0].length;
  const outLen = stretchOutputLength(inLen, tempo);
  const { inLat, outLat, bufLen, base } = prepareStretch(
    api,
    nCh,
    sampleRate,
    inLen,
    tempo,
    semitones,
  );
  const view = (off: number, n: number) =>
    new Float32Array(api.memory.buffer, base + off * 4, n);
  const inView = (c: number, n: number) => view(bufLen * c, n);
  const outView = (c: number, n: number) => view(bufLen * (c + nCh), n);
  // Zero-padded input read.
  const readPadded = (c: number, start: number, n: number, dst: Float32Array) => {
    const src = channels[c];
    dst.fill(0);
    const s = Math.max(0, start);
    const e = Math.min(inLen, start + n);
    if (e > s) dst.set(src.subarray(s, e), s - start);
  };
  const out = channels.map(() => new Float32Array(outLen));
  // Seek: the pre-roll is the first inLat samples (centred on the first block).
  for (let c = 0; c < nCh; c += 1) readPadded(c, 0, inLat, inView(c, inLat));
  api.seek(inLat, inLen / outLen);
  // Process: input read ahead by inLat; outLen output samples, shifted by outLat.
  let inPos = 0;
  let outPos = 0;
  const staged = channels.map(() => new Float32Array(outLen));
  while (outPos < outLen) {
    const nOut = Math.min(chunk, outLen - outPos);
    const inEnd = Math.round(((outPos + nOut) * inLen) / outLen);
    const nIn = inEnd - inPos;
    for (let c = 0; c < nCh; c += 1) {
      readPadded(c, inPos + inLat, nIn, inView(c, nIn));
    }
    api.process(nIn, nOut);
    for (let c = 0; c < nCh; c += 1) staged[c].set(outView(c, nOut), outPos);
    inPos = inEnd;
    outPos += nOut;
  }
  for (let c = 0; c < nCh; c += 1) {
    const ch = staged[c];
    // Fold the first outLat samples back onto themselves (as exact()).
    for (let i = 0; i < Math.min(outLen - outLat, outLat); i += 1) {
      ch[i + outLat] -= ch[outLat - 1 - i];
    }
    out[c].set(ch.subarray(outLat), 0);
  }
  api.flush(outLat);
  for (let c = 0; c < nCh; c += 1) {
    out[c].set(outView(c, outLat), outLen - outLat);
  }
  return { out, inLat, outLat };
}

/**
 * Receives output frames in order. The arrays are views into reusable
 * buffers: valid only during the call.
 */
export type StretchOutputSink = (channels: Float32Array[], frames: number) => void;

/**
 * Chunk-streamed stretch that reproduces {@link stretchOffline} byte for byte
 * while holding only bounded input/output windows (never the whole song):
 * push planar input in any chunk sizes, then {@link finish}. The total input
 * length must be known up front (the output length and seek rate derive from
 * it).
 *
 * With `padToMinimum`, input shorter than the engine minimum is zero-padded
 * to it and the output trimmed to round(input / tempo) instead of throwing
 * (inputs at or above the minimum are unaffected).
 */
export class StreamingStretch {
  /** Frames delivered to the sink: round(inputLength / tempo). */
  readonly outputLength: number;
  /** Frames the caller pushes. */
  readonly inputLength: number;
  private readonly engineInputLength: number;
  private readonly engineOutputLength: number;
  private delivered = 0;
  private readonly api: StretchApi;
  private readonly nCh: number;
  private readonly inLat: number;
  private readonly outLat: number;
  private readonly bufLen: number;
  private readonly base: number;
  private readonly sink: StretchOutputSink;
  /** Pending input frames, planar; absolute index of fifo[c][0] is fifoStart. */
  private fifo: Float32Array[];
  private fifoStart = 0;
  private fifoLength = 0;
  private received = 0;
  private seeked = false;
  private inPos = 0;
  private outPos = 0;
  private finished = false;
  /** First outLat staged samples per channel (the fold source). */
  private readonly head: Float32Array[];
  private readonly emitBuffers: Float32Array[];

  constructor(
    api: StretchApi,
    options: {
      channelCount: number;
      sampleRate: number;
      inputLength: number;
      sink: StretchOutputSink;
      padToMinimum?: boolean;
    } & StretchParams,
  ) {
    const { tempo, semitones } = validateParams(options);
    this.api = api;
    this.nCh = options.channelCount;
    this.inputLength = options.inputLength;
    this.outputLength = stretchOutputLength(options.inputLength, tempo);
    this.sink = options.sink;
    const prepared = prepareStretch(
      api,
      this.nCh,
      options.sampleRate,
      this.inputLength,
      tempo,
      semitones,
      options.padToMinimum === true,
    );
    this.engineInputLength = prepared.engineInputLength;
    this.engineOutputLength = prepared.engineOutputLength;
    this.inLat = prepared.inLat;
    this.outLat = prepared.outLat;
    this.bufLen = prepared.bufLen;
    this.base = prepared.base;
    const initial = Math.max(this.bufLen + this.inLat, 1 << 16);
    this.fifo = Array.from({ length: this.nCh }, () => new Float32Array(initial));
    this.head = Array.from({ length: this.nCh }, () => new Float32Array(this.outLat));
    const emitLength = Math.max(REMIX_STRETCH_DRIVER.chunk, this.outLat);
    this.emitBuffers = Array.from(
      { length: this.nCh },
      () => new Float32Array(emitLength),
    );
  }

  /** Append planar input (equal-length channels) and process what it allows. */
  push(input: Float32Array[]): void {
    if (this.finished) throw new Error("StreamingStretch already finished");
    const frames = input[0]?.length ?? 0;
    if (frames === 0) return;
    if (this.received + frames > this.inputLength) {
      throw new RangeError("More input than the declared input length");
    }
    this.append(input, frames);
    this.pump();
  }

  private append(input: Float32Array[] | null, frames: number): void {
    this.ensureFifoCapacity(this.fifoLength + frames);
    for (let c = 0; c < this.nCh; c += 1) {
      if (input) this.fifo[c].set(input[c].subarray(0, frames), this.fifoLength);
      else this.fifo[c].fill(0, this.fifoLength, this.fifoLength + frames);
    }
    this.fifoLength += frames;
    this.received += frames;
  }

  /** Forward output, trimmed to {@link outputLength} (padding only). */
  private deliver(channels: Float32Array[], frames: number): void {
    const n = Math.min(frames, this.outputLength - this.delivered);
    if (n > 0) this.sink(channels, n);
    this.delivered += frames;
  }

  /** Process the rest (the declared input must be complete) and flush. */
  finish(): void {
    if (this.finished) return;
    if (this.received !== this.inputLength) {
      throw new RangeError(
        `Input ended at ${this.received} of ${this.inputLength} frames`,
      );
    }
    // Zero padding up to the engine minimum (padToMinimum only).
    if (this.engineInputLength > this.received) {
      this.append(null, this.engineInputLength - this.received);
    }
    this.pump();
    if (this.outPos !== this.engineOutputLength) {
      throw new Error("StreamingStretch did not reach the output length");
    }
    this.api.flush(this.outLat);
    const tail = this.outViews(this.outLat);
    this.deliver(tail, this.outLat);
    this.finished = true;
  }

  private ensureFifoCapacity(needed: number): void {
    if (needed <= this.fifo[0].length) return;
    const next = Math.max(needed, this.fifo[0].length * 2);
    this.fifo = this.fifo.map((old) => {
      const grown = new Float32Array(next);
      grown.set(old.subarray(0, this.fifoLength));
      return grown;
    });
  }

  /** Drop consumed input before absolute index `upTo`. */
  private consumeUntil(upTo: number): void {
    const drop = Math.min(this.fifoLength, Math.max(0, upTo - this.fifoStart));
    if (drop === 0) return;
    for (let c = 0; c < this.nCh; c += 1) {
      this.fifo[c].copyWithin(0, drop, this.fifoLength);
    }
    this.fifoLength -= drop;
    this.fifoStart += drop;
  }

  /** Zero-padded read of absolute input [start, start + n) into dst. */
  private readPadded(c: number, start: number, n: number, dst: Float32Array): void {
    dst.fill(0);
    const s = Math.max(0, start);
    const e = Math.min(this.engineInputLength, start + n);
    if (e > s) {
      dst.set(
        this.fifo[c].subarray(s - this.fifoStart, e - this.fifoStart),
        s - start,
      );
    }
  }

  private view(off: number, n: number): Float32Array {
    return new Float32Array(this.api.memory.buffer, this.base + off * 4, n);
  }

  private outViews(n: number): Float32Array[] {
    return Array.from({ length: this.nCh }, (_, c) =>
      this.view(this.bufLen * (c + this.nCh), n),
    );
  }

  /** Whether input up to absolute index `end` (clipped to the length) is here. */
  private available(end: number): boolean {
    return this.received >= Math.min(this.engineInputLength, end);
  }

  private pump(): void {
    const { chunk } = REMIX_STRETCH_DRIVER;
    const inLen = this.engineInputLength;
    const outLen = this.engineOutputLength;
    if (!this.seeked) {
      if (!this.available(this.inLat)) return;
      for (let c = 0; c < this.nCh; c += 1) {
        this.readPadded(c, 0, this.inLat, this.view(this.bufLen * c, this.inLat));
      }
      this.api.seek(this.inLat, inLen / outLen);
      this.seeked = true;
      this.consumeUntil(this.inLat);
    }
    while (this.outPos < outLen) {
      const nOut = Math.min(chunk, outLen - this.outPos);
      const inEnd = Math.round(((this.outPos + nOut) * inLen) / outLen);
      const nIn = inEnd - this.inPos;
      if (!this.available(inEnd + this.inLat)) return;
      for (let c = 0; c < this.nCh; c += 1) {
        this.readPadded(
          c,
          this.inPos + this.inLat,
          nIn,
          this.view(this.bufLen * c, nIn),
        );
      }
      this.api.process(nIn, nOut);
      this.stage(this.outViews(nOut), nOut);
      this.inPos = inEnd;
      this.outPos += nOut;
      this.consumeUntil(this.inPos + this.inLat);
    }
  }

  /**
   * Route staged samples [outPos, outPos + n): the first outLat are held as
   * the fold source; [outLat, 2·outLat) are emitted minus their mirrored head
   * sample (the offline fold, same float32 rounding); later ones pass through.
   * Staged index j lands at output index j − outLat.
   */
  private stage(staged: Float32Array[], n: number): void {
    const outLat = this.outLat;
    const start = this.outPos;
    let k = 0;
    if (start < outLat) {
      const take = Math.min(n, outLat - start);
      for (let c = 0; c < this.nCh; c += 1) {
        this.head[c].set(staged[c].subarray(0, take), start);
      }
      k = take;
    }
    if (k >= n) return;
    const frames = n - k;
    const emit = this.emitBuffers.map((buffer) => buffer.subarray(0, frames));
    for (let c = 0; c < this.nCh; c += 1) {
      const src = staged[c];
      const dst = emit[c];
      const head = this.head[c];
      for (let i = 0; i < frames; i += 1) {
        const j = start + k + i;
        dst[i] = j < 2 * outLat ? src[k + i] - head[2 * outLat - 1 - j] : src[k + i];
      }
    }
    this.deliver(emit, frames);
  }
}

// --- Render stage (worker thread) ---------------------------------------------

/** Frames read from the raw input per step inside the worker. */
const WORKER_READ_FRAMES = 1 << 16;
const WORKER_KIND = "remix-stretch/worker";

type WorkerReply =
  | { ok: true; result: StretchFileResult }
  | { ok: false; error: string; tooShort: boolean; inputLength?: number };

export type StretchFileJob = {
  /** Raw interleaved little-endian 16-bit stereo at 48 kHz (ffmpeg s16le). */
  inputPath: string;
  /** Destination 48 kHz stereo 16-bit PCM WAV (TPDF-dithered). */
  outputPath: string;
  tempo: number;
  semitones: number;
  /** mulberry32 seed of this file's dither (fixed per input index). */
  ditherSeed: number;
};

export type StretchFileResult = {
  inputFrames: number;
  outputFrames: number;
  elapsedMs: number;
};

/**
 * Base of the per-input dither seeds (seed = base + input index): the 16-bit
 * file stage is deterministic for identical renders.
 */
export const REMIX_STRETCH_DITHER_SEED_BASE = 0x1898;

/** 44-byte PCM (format 1) 16-bit WAV header. */
export function pcm16WavHeader(
  frames: number,
  channels: number,
  sampleRate: number,
): Buffer {
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  if (dataBytes + 36 > 0xffffffff) {
    throw new RangeError("Stretched audio exceeds the WAV size limit.");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // WAVE_FORMAT_PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** mulberry32 PRNG → [0, 1). Exact 32-bit integer arithmetic. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic float → 16-bit quantiser with TPDF dither: each sample
 * (frame-major, channel-minor order) becomes
 * clamp(round(x·32768 + u1 − u2), −32768, 32767), u1/u2 two draws of
 * mulberry32(seed) — triangular ±1 LSB noise, clipping at full scale. The
 * state carries across calls, so any chunking yields the same bytes.
 */
export function createPcm16Quantizer(
  seed: number,
): (channels: Float32Array[], frames: number, out: Buffer) => void {
  const rng = mulberry32(seed);
  return (channels, frames, out) => {
    const nCh = channels.length;
    for (let i = 0; i < frames; i += 1) {
      for (let c = 0; c < nCh; c += 1) {
        const dither = rng() - rng();
        const q = Math.round(channels[c][i] * 32768 + dither);
        out.writeInt16LE(q > 32767 ? 32767 : q < -32768 ? -32768 : q, (i * nCh + c) * 2);
      }
    }
  };
}

/**
 * Stretch a raw s16le stereo file (converted to float ÷ 32768) into a
 * TPDF-dithered 16-bit PCM WAV, synchronously and chunk-streamed (bounded
 * memory for any length). 16-bit intermediates halve the render's temp-dir
 * footprint; the engine's float output — the parity contract — is unchanged,
 * only this file stage quantises. Input shorter than the engine minimum is
 * zero-padded and the output trimmed to round(input / tempo). Runs inside the
 * worker; the tests also call it directly.
 */
export async function stretchRawFileToWav(
  job: StretchFileJob,
): Promise<StretchFileResult> {
  const started = Date.now();
  const nCh = REMIX_STRETCH_CHANNELS;
  const frameBytes = nCh * 2;
  const inputBytes = statSync(job.inputPath).size;
  if (inputBytes % frameBytes !== 0) {
    throw new Error("Decoded audio is not whole stereo 16-bit frames.");
  }
  const inputFrames = inputBytes / frameBytes;
  const api = await createStretchEngine();
  const quantize = createPcm16Quantizer(job.ditherSeed);
  const input = openSync(job.inputPath, "r");
  let output: number | null = null;
  try {
    output = openSync(job.outputPath, "w");
    const out = output;
    let outBytes = Buffer.alloc(REMIX_STRETCH_DRIVER.chunk * frameBytes);
    const stretch = new StreamingStretch(api, {
      channelCount: nCh,
      sampleRate: REMIX_STRETCH_SAMPLE_RATE,
      inputLength: inputFrames,
      tempo: job.tempo,
      semitones: job.semitones,
      padToMinimum: true,
      sink: (channels, frames) => {
        const size = frames * frameBytes;
        if (outBytes.length < size) outBytes = Buffer.alloc(size);
        quantize(channels, frames, outBytes);
        writeSync(out, outBytes, 0, size);
      },
    });
    writeSync(
      out,
      pcm16WavHeader(stretch.outputLength, nCh, REMIX_STRETCH_SAMPLE_RATE),
    );
    const inBytes = Buffer.alloc(WORKER_READ_FRAMES * frameBytes);
    const planar = Array.from(
      { length: nCh },
      () => new Float32Array(WORKER_READ_FRAMES),
    );
    let position = 0;
    while (position < inputBytes) {
      const want = Math.min(inBytes.length, inputBytes - position);
      let got = 0;
      while (got < want) {
        const n = readSync(input, inBytes, got, want - got, position + got);
        if (n === 0) throw new Error("Decoded audio ended early.");
        got += n;
      }
      const frames = got / frameBytes;
      for (let i = 0; i < frames; i += 1) {
        for (let c = 0; c < nCh; c += 1) {
          planar[c][i] = inBytes.readInt16LE((i * nCh + c) * 2) / 32768;
        }
      }
      stretch.push(planar.map((channel) => channel.subarray(0, frames)));
      position += got;
    }
    stretch.finish();
    return {
      inputFrames,
      outputFrames: stretch.outputLength,
      elapsedMs: Date.now() - started,
    };
  } finally {
    closeSync(input);
    if (output !== null) closeSync(output);
  }
}

/**
 * Run {@link stretchRawFileToWav} in a `worker_threads` worker (one per job)
 * so the render's event loop stays responsive. Under ts-node/jest the worker
 * bootstraps ts-node (transpile-only); the built service runs the compiled
 * `.js` directly.
 */
export function stretchRawFileToWavInWorker(
  job: StretchFileJob,
  { timeoutMs = 300_000 }: { timeoutMs?: number } = {},
): Promise<StretchFileResult> {
  const data = { kind: WORKER_KIND, job };
  const worker = __filename.endsWith(".ts")
    ? new Worker(
        [
          `require("ts-node").register({ transpileOnly: true, skipProject: true, compilerOptions: { module: "CommonJS", target: "ES2022", esModuleInterop: true } });`,
          `require(${JSON.stringify(__filename)});`,
        ].join("\n"),
        { eval: true, workerData: data },
      )
    : new Worker(__filename, { workerData: data });
  return new Promise<StretchFileResult>((resolvePromise, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      settle(() => reject(new Error("Time-stretch worker timed out.")));
      void worker.terminate();
    }, timeoutMs);
    worker.once("message", (message: WorkerReply) => {
      settle(() => {
        if (message.ok) resolvePromise(message.result);
        else if (message.tooShort) {
          reject(new StretchTooShortError(message.inputLength ?? 0));
        } else reject(new Error(message.error));
      });
    });
    worker.once("error", (error) => settle(() => reject(error)));
    worker.once("exit", (code) =>
      settle(() =>
        reject(new Error(`Time-stretch worker exited with code ${code}.`)),
      ),
    );
  });
}

if (
  !isMainThread &&
  parentPort &&
  (workerData as { kind?: unknown } | null)?.kind === WORKER_KIND
) {
  const port = parentPort;
  const { job } = workerData as { job: StretchFileJob };
  stretchRawFileToWav(job).then(
    (result) => port.postMessage({ ok: true, result } satisfies WorkerReply),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        tooShort: error instanceof StretchTooShortError,
        ...(error instanceof StretchTooShortError
          ? { inputLength: error.inputLength }
          : {}),
      } satisfies WorkerReply),
  );
}
