// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createStretchEngine,
  fetchRemixStretchWasm,
  minimumInputLength,
  REMIX_STRETCH_DRIVER,
  REMIX_STRETCH_ENGINE,
  REMIX_STRETCH_WASM_SHA256,
  REMIX_STRETCH_WASM_URL,
  sha256Hex,
  stretchOffline,
  stretchOutputLength,
} from "./remixStretch";
import {
  createStretchModuleLoader,
  runStretchJob,
  STRETCH_ENGINE_LOAD_ERROR,
  STRETCH_JOB_ERROR,
  throttleProgress,
  type StretchWorkerResponse,
} from "./remixStretchProtocol";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(HERE, "../../public", REMIX_STRETCH_WASM_URL.slice(1));
const FIXTURE_PATH = path.resolve(
  HERE,
  "../../../backend/src/modules/remix/remix-stretch-v1.parity.json",
);

type Fixture = {
  schemaVersion: string;
  engine: { package: string; version: string; wasmSha256: string; wasmBytes: number };
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

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const wasmBytes = new Uint8Array(readFileSync(WASM_PATH));

/** The fixture's documented input generator (chord + LCG noise bursts). */
function makeTestSignal(sampleRate: number, seconds: number): Float32Array[] {
  const n = Math.round(sampleRate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let s = 12345;
  const nz = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const chord =
      0.2 *
      (Math.sin(2 * Math.PI * 220 * t) +
        Math.sin(2 * Math.PI * 277.18 * t) +
        Math.sin(2 * Math.PI * 329.63 * t));
    const ph = t % 0.5;
    const burst = ph < 0.03 ? 0.5 * nz() * (1 - ph / 0.03) : 0;
    left[i] = chord + burst;
    right[i] = 0.8 * chord - burst * 0.7;
  }
  return [left, right];
}

/** sha256 over little-endian float32, L then R (the fixture's hash). */
async function channelsSha256(channels: Float32Array[]): Promise<string> {
  const total = channels.reduce((sum, channel) => sum + channel.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const channel of channels) {
    bytes.set(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength), offset);
    offset += channel.byteLength;
  }
  return sha256Hex(bytes);
}

describe("remix-stretch/v1 parity with the server render (#1898)", () => {
  const input = makeTestSignal(fixture.input.sampleRate, fixture.input.seconds);

  it("pins the engine, the WASM and the driver", async () => {
    expect(`${fixture.engine.package}@${fixture.engine.version}`).toBe(REMIX_STRETCH_ENGINE);
    expect(fixture.engine.wasmSha256).toBe(REMIX_STRETCH_WASM_SHA256);
    expect(wasmBytes.byteLength).toBe(fixture.engine.wasmBytes);
    expect(await sha256Hex(wasmBytes)).toBe(REMIX_STRETCH_WASM_SHA256);
    expect(fixture.driver).toEqual({ ...REMIX_STRETCH_DRIVER });
  });

  it("regenerates the documented input", async () => {
    expect(await channelsSha256(input)).toBe(fixture.input.sha256);
  });

  it.each(fixture.cases)(
    "tempo $tempo, semitones $semitones is byte-identical",
    async ({ tempo, semitones, outputLength, sha256, first }) => {
      const api = await createStretchEngine(wasmBytes);
      const { out } = stretchOffline(api, input, fixture.input.sampleRate, {
        tempo,
        semitones,
      });
      expect(out[0].length).toBe(outputLength);
      expect(stretchOutputLength(input[0].length, tempo)).toBe(outputLength);
      expect(Array.from(out[0].slice(4800, 4804))).toEqual(first);
      expect(await channelsSha256(out)).toBe(sha256);
    },
  );

  it("reuses a compiled module across fresh instances deterministically", async () => {
    const compiled = await WebAssembly.compile(wasmBytes);
    const reference = fixture.cases[3];
    for (let run = 0; run < 2; run += 1) {
      const api = await createStretchEngine(compiled);
      const { out } = stretchOffline(api, input, fixture.input.sampleRate, reference);
      expect(await channelsSha256(out)).toBe(reference.sha256);
    }
  });
});

describe("time-stretch loader guards (#1898)", () => {
  it("fetches and verifies the same-origin WASM", async () => {
    const fetchImpl = vi.fn(async () => new Response(wasmBytes.slice()));
    const bytes = await fetchRemixStretchWasm(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(REMIX_STRETCH_WASM_URL);
    expect(bytes.byteLength).toBe(wasmBytes.byteLength);
  });

  it("rejects a tampered or missing WASM", async () => {
    const tampered = wasmBytes.slice();
    tampered[tampered.length - 1] ^= 1;
    await expect(createStretchEngine(tampered)).rejects.toThrow(/integrity/);
    await expect(
      fetchRemixStretchWasm((async () => new Response(tampered)) as unknown as typeof fetch),
    ).rejects.toThrow(/integrity/);
    await expect(
      fetchRemixStretchWasm(
        (async () => new Response("missing", { status: 404 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/404/);
  });

  it("refuses audio shorter than twice the output latency", async () => {
    const api = await createStretchEngine(wasmBytes);
    expect(() =>
      stretchOffline(api, [new Float32Array(1000)], 48_000, { tempo: 0.85 }),
    ).toThrow(/too short/);
  });
});

describe("padded driver for short stems (#1898)", () => {
  const signal = makeTestSignal(48_000, 1);

  it("equals the offline stretch of the zero-padded input, trimmed to round(len/tempo)", async () => {
    const tempo = 0.85;
    const probe = await createStretchEngine(wasmBytes);
    const { outLat } = stretchOffline(probe, signal, 48_000, { tempo });
    const minimum = minimumInputLength(outLat, tempo);
    expect(stretchOutputLength(minimum, tempo)).toBeGreaterThanOrEqual(2 * outLat);
    expect(stretchOutputLength(minimum - 1, tempo)).toBeLessThan(2 * outLat);

    const short = signal.map((channel) => channel.slice(0, 1000));
    const { out } = stretchOffline(
      await createStretchEngine(wasmBytes),
      short,
      48_000,
      { tempo, semitones: 2 },
      { padToMinimum: true },
    );
    expect(out[0].length).toBe(Math.round(1000 / tempo));
    const padded = short.map((channel) => {
      const buffer = new Float32Array(minimum);
      buffer.set(channel);
      return buffer;
    });
    const reference = stretchOffline(await createStretchEngine(wasmBytes), padded, 48_000, {
      tempo,
      semitones: 2,
    }).out.map((channel) => channel.slice(0, out[0].length));
    expect(await channelsSha256(out)).toBe(await channelsSha256(reference));
  });

  it("leaves an input at the minimum unpadded", async () => {
    const tempo = 1.2;
    const probe = await createStretchEngine(wasmBytes);
    const { outLat } = stretchOffline(probe, signal, 48_000, { tempo });
    const input = signal.map((channel) =>
      channel.slice(0, minimumInputLength(outLat, tempo)),
    );
    const plain = stretchOffline(await createStretchEngine(wasmBytes), input, 48_000, { tempo });
    const padded = stretchOffline(
      await createStretchEngine(wasmBytes),
      input,
      48_000,
      { tempo },
      { padToMinimum: true },
    );
    expect(await channelsSha256(padded.out)).toBe(await channelsSha256(plain.out));
  });

  it("keeps the parity output when padding is allowed", async () => {
    const reference = fixture.cases[3];
    const input = makeTestSignal(fixture.input.sampleRate, fixture.input.seconds);
    const { out } = stretchOffline(
      await createStretchEngine(wasmBytes),
      input,
      fixture.input.sampleRate,
      reference,
      { padToMinimum: true },
    );
    expect(await channelsSha256(out)).toBe(reference.sha256);
  });
});

describe("stretch worker job (#1898)", () => {
  const compiled = () => WebAssembly.compile(wasmBytes);

  it("posts throttled progress, then the transferred result of the pinned driver", async () => {
    const reference = fixture.cases[3];
    const input = makeTestSignal(fixture.input.sampleRate, fixture.input.seconds);
    const messages: StretchWorkerResponse[] = [];
    const transfers: Transferable[][] = [];
    await runStretchJob(
      {
        type: "stretch",
        jobId: "job-1",
        sampleRate: fixture.input.sampleRate,
        tempo: reference.tempo,
        semitones: reference.semitones,
        channels: input,
      },
      compiled,
      (message, transfer) => {
        messages.push(message);
        transfers.push(transfer ?? []);
      },
    );
    const done = messages.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.jobId).toBe("job-1");
    expect(await channelsSha256(done.channels)).toBe(reference.sha256);
    expect(transfers.at(-1)).toEqual(done.channels.map((channel) => channel.buffer));
    const progress = messages.filter((message) => message.type === "progress");
    expect(progress.length).toBeGreaterThan(3);
    expect(progress.length).toBeLessThanOrEqual(21);
    expect(progress.at(-1)).toMatchObject({ fraction: 1 });
  });

  it("stretches a short stem zero-padded instead of failing", async () => {
    const messages: StretchWorkerResponse[] = [];
    await runStretchJob(
      {
        type: "stretch",
        jobId: "short",
        sampleRate: 48_000,
        tempo: 0.85,
        semitones: 0,
        channels: [new Float32Array(1000)],
      },
      compiled,
      (message) => messages.push(message),
    );
    const done = messages.at(-1);
    expect(done?.type === "done" && done.channels[0].length).toBe(Math.round(1000 / 0.85));
  });

  it("reports plain-language errors", async () => {
    const messages: StretchWorkerResponse[] = [];
    await runStretchJob(
      { type: "stretch", jobId: "a", sampleRate: 48_000, tempo: 1, semitones: 2, channels: [] },
      async () => {
        throw new Error("404");
      },
      (message) => messages.push(message),
    );
    await runStretchJob(
      { type: "stretch", jobId: "b", sampleRate: 48_000, tempo: -1, semitones: 0, channels: [new Float32Array(48_000)] },
      compiled,
      (message) => messages.push(message),
    );
    expect(messages).toEqual([
      { type: "error", jobId: "a", message: STRETCH_ENGINE_LOAD_ERROR },
      { type: "error", jobId: "b", message: STRETCH_JOB_ERROR },
    ]);
  });

  it("loads the engine once and retries a failed load", async () => {
    const load = vi
      .fn<() => Promise<ArrayBuffer>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(wasmBytes.slice().buffer);
    const loader = createStretchModuleLoader(load);
    await expect(loader()).rejects.toThrow("offline");
    const first = await loader();
    expect(await loader()).toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("throttles progress to about every 5%", () => {
    const seen: number[] = [];
    const report = throttleProgress((fraction) => seen.push(fraction));
    for (let i = 1; i <= 100; i += 1) report(i / 100);
    expect(seen.length).toBe(20);
    expect(seen.at(-1)).toBe(1);
  });
});
