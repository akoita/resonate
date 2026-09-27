/**
 * Remix Studio time-stretch / pitch-shift engine (#1898), browser side.
 *
 * The vendored Signalsmith Stretch 1.3.2 WASM (MIT, see NOTICE) served from
 * `/wasm/`, driven by the same loader and offline driver as the server render
 * (`backend/src/modules/remix/remix-stretch.ts`). The WASM is scalar-only, so
 * both produce byte-identical output; the committed fixture
 * `backend/src/modules/remix/remix-stretch-v1.parity.json` pins it. No Web
 * Audio: the npm AudioWorklet node re-seeks every render quantum and is not
 * sample-comparable, so it is not used.
 *
 * Browser-safe (no Node APIs): meant to run inside Web Workers.
 */

export const REMIX_STRETCH_ENGINE = "signalsmith-stretch@1.3.2";
export const REMIX_STRETCH_WASM_URL = "/wasm/signalsmith-stretch-1.3.2.wasm";
/** sha256 of the vendored WASM; verified before instantiation. */
export const REMIX_STRETCH_WASM_SHA256 =
  "83869197b3c5ebf9fc8c517a1586aef1ecf77404842218d62b9c0e82882d8ca3";
/** Pinned driver parameters (part of the parity contract). */
export const REMIX_STRETCH_DRIVER = Object.freeze({
  chunk: 4096,
  preset: "default" as const,
  tonalityHz: 8000,
  seed: 0x5eed,
});

/** Minified emscripten export names of the pinned WASM, in order. */
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

export type StretchParams = {
  /** Playback rate: 0.85 = slower (output is 1/0.85 × longer). */
  tempo?: number;
  /** Pitch shift in semitones. */
  semitones?: number;
};

function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Hex sha256 via Web Crypto. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Throws unless `bytes` is the pinned WASM. */
export async function assertRemixStretchWasm(
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  const digest = await sha256Hex(bytes);
  if (digest !== REMIX_STRETCH_WASM_SHA256) {
    throw new Error(`Time-stretch WASM integrity check failed (sha256 ${digest}).`);
  }
}

/** Fetch and verify the vendored WASM (same-origin static asset). */
export async function fetchRemixStretchWasm(
  fetchImpl: typeof fetch = fetch,
  url: string = REMIX_STRETCH_WASM_URL,
): Promise<ArrayBuffer> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Could not load the time-stretch engine (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  await assertRemixStretchWasm(bytes);
  return bytes;
}

/**
 * Instantiate a fresh engine from WASM bytes (verified here) or an already
 * compiled module: the 4 hand-written imports (abort, memcpy, heap growth and
 * a seeded xorshift32 in place of random_get), the export-list assertion,
 * then the C++ constructors.
 */
export async function createStretchEngine(
  wasm: ArrayBuffer | Uint8Array | WebAssembly.Module,
  { seed = REMIX_STRETCH_DRIVER.seed }: { seed?: number } = {},
): Promise<StretchApi> {
  let compiled: WebAssembly.Module;
  if (wasm instanceof WebAssembly.Module) {
    compiled = wasm;
  } else {
    await assertRemixStretchWasm(wasm);
    compiled = await WebAssembly.compile(toArrayBuffer(wasm));
  }
  type Exports = Record<string, unknown> & {
    e: WebAssembly.Memory;
    f: () => void;
  };
  let ex: Exports | null = null;
  let u8: Uint8Array | null = null;
  const memory = () => ex!.e;
  const heap = () =>
    u8 && u8.buffer === memory().buffer ? u8 : (u8 = new Uint8Array(memory().buffer));
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
        const target = Math.max(requested, Math.min(current * 1.5, requested + 100663296));
        const pages = Math.ceil((Math.ceil(target / 65536) * 65536 - current) / 65536);
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
  ex = instance.exports as unknown as Exports;
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

/** Output length of a stretch: round(input / tempo). */
export function stretchOutputLength(inputLength: number, tempo: number): number {
  return Math.round(inputLength / tempo);
}

/**
 * Whole-buffer offline stretch, equivalent to C++ SignalsmithStretch::exact()
 * and byte-identical to the server driver: output length = round(input /
 * tempo), latency compensated, the start folded back, the tail flushed; fixed
 * 4096-sample output chunks. `channels` share one length.
 */
export function stretchOffline(
  api: StretchApi,
  channels: Float32Array[],
  sampleRate: number,
  params: StretchParams = {},
): { out: Float32Array[]; inLat: number; outLat: number } {
  const tempo = params.tempo ?? 1;
  const semitones = params.semitones ?? 0;
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new RangeError("tempo must be a positive finite number");
  }
  if (!Number.isFinite(semitones)) throw new RangeError("semitones must be finite");
  const { chunk, tonalityHz } = REMIX_STRETCH_DRIVER;
  const nCh = channels.length;
  const inLen = channels[0].length;
  const outLen = stretchOutputLength(inLen, tempo);
  api.presetDefault(nCh, sampleRate);
  api.setTransposeSemitones(semitones, tonalityHz / sampleRate);
  api.setFormantSemitones(0, 0);
  api.setFormantBase(0);
  const inLat = api.inputLatency();
  const outLat = api.outputLatency();
  if (outLen < outLat * 2) {
    throw new RangeError(`Audio too short to time-stretch (${inLen} samples).`);
  }
  const maxIn = Math.ceil(chunk * tempo) + 2;
  const bufLen = Math.max(
    maxIn,
    chunk,
    api.blockSamples() + api.intervalSamples(),
    inLat,
    outLat,
  );
  const base = api.setBuffers(nCh, bufLen);
  const view = (off: number, n: number) =>
    new Float32Array(api.memory.buffer, base + off * 4, n);
  const inView = (c: number, n: number) => view(bufLen * c, n);
  const outView = (c: number, n: number) => view(bufLen * (c + nCh), n);
  const readPadded = (c: number, start: number, n: number, dst: Float32Array) => {
    const src = channels[c];
    dst.fill(0);
    const s = Math.max(0, start);
    const e = Math.min(inLen, start + n);
    if (e > s) dst.set(src.subarray(s, e), s - start);
  };
  const out = channels.map(() => new Float32Array(outLen));
  // Seek: the pre-roll is the first inLat samples.
  for (let c = 0; c < nCh; c += 1) readPadded(c, 0, inLat, inView(c, inLat));
  api.seek(inLat, inLen / outLen);
  let inPos = 0;
  let outPos = 0;
  const staged = channels.map(() => new Float32Array(outLen));
  while (outPos < outLen) {
    const nOut = Math.min(chunk, outLen - outPos);
    const inEnd = Math.round(((outPos + nOut) * inLen) / outLen);
    const nIn = inEnd - inPos;
    for (let c = 0; c < nCh; c += 1) readPadded(c, inPos + inLat, nIn, inView(c, nIn));
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
  for (let c = 0; c < nCh; c += 1) out[c].set(outView(c, outLat), outLen - outLat);
  return { out, inLat, outLat };
}
