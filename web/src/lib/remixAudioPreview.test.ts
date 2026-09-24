import { describe, expect, it, vi } from "vitest";
import {
  createStemPreviewEngine,
  PREVIEW_LIMITER_RATIO,
  PREVIEW_LIMITER_THRESHOLD_DB,
  stemPreviewGain,
} from "./remixAudioPreview";

/**
 * Minimal fake WebAudio graph: enough surface for the preview engine to wire
 * sources → gains → limiter → analyser → destination and for tests to poke
 * the limiter's reduction and the analyser's samples.
 */
class FakeParam {
  value = 1;
  setValueAtTime(value: number) {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this;
  }
}

class FakeNode {
  connect<T>(target: T): T {
    return target;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  reduction = 0;
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  samples: number[] = [];
  getFloatTimeDomainData(target: Float32Array) {
    target.fill(0);
    this.samples.forEach((sample, index) => {
      target[index] = sample;
    });
  }
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  compressor: FakeCompressor | null = null;
  analyser: FakeAnalyser | null = null;
  sources: FakeSource[] = [];
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({
    decodedFrom: data,
  }));
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createDynamicsCompressor() {
    this.compressor = new FakeCompressor();
    return this.compressor;
  }
  createAnalyser() {
    this.analyser = new FakeAnalyser();
    return this.analyser;
  }
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

function okResponse(): Response {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response;
}

function setup(fetchImpl = vi.fn(async () => okResponse())) {
  const contexts: FakeAudioContext[] = [];
  const engine = createStemPreviewEngine({
    urlForStem: (stemId) => `/stems/${stemId}`,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    audioContextFactory: () => {
      const context = new FakeAudioContext();
      contexts.push(context);
      return context as unknown as AudioContext;
    },
  });
  return { engine, fetchImpl, contexts };
}

const stems = [
  { stemId: "vocals", gainDb: 0, muted: false },
  { stemId: "drums", gainDb: -6, muted: false },
];

describe("createStemPreviewEngine", () => {
  it("fetches and decodes each stem once across repeated plays", async () => {
    const { engine, fetchImpl, contexts } = setup();
    const first = await engine.play({ stems, soloStemId: null });
    first.stop();
    await engine.play({ stems, soloStemId: null });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(contexts).toHaveLength(1); // one context reused across plays
    expect(contexts[0].decodeAudioData).toHaveBeenCalledTimes(2);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    // Fresh sources per play (buffer sources are single-use).
    expect(contexts[0].sources).toHaveLength(4);
    expect(contexts[0].compressor?.threshold.value).toBe(
      PREVIEW_LIMITER_THRESHOLD_DB,
    );
    expect(contexts[0].compressor?.ratio.value).toBe(PREVIEW_LIMITER_RATIO);
    engine.dispose();
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
  });

  it("stops the previous playback when play is pressed again", async () => {
    const { engine, contexts } = setup();
    await engine.play({ stems, soloStemId: null });
    const [firstVocals, firstDrums] = contexts[0].sources;
    await engine.play({ stems, soloStemId: null });
    expect(firstVocals.stop).toHaveBeenCalled();
    expect(firstDrums.stop).toHaveBeenCalled();
  });

  it("retries a stem whose fetch failed on the next play", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValue(okResponse());
    const { engine } = setup(fetchImpl);

    await expect(
      engine.play({ stems: [stems[0]], soloStemId: null }),
    ).rejects.toThrow(/unavailable/);
    const handle = await engine.play({ stems: [stems[0]], soloStemId: null });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("fires onEnded once when every source ends, never after stop()", async () => {
    const { engine, contexts } = setup();
    const onEnded = vi.fn();
    await engine.play({ stems, soloStemId: null, onEnded });
    for (const source of contexts[0].sources) source.onended?.();
    expect(onEnded).toHaveBeenCalledTimes(1);

    const stoppedEnded = vi.fn();
    const handle = await engine.play({
      stems,
      soloStemId: null,
      onEnded: stoppedEnded,
    });
    handle.stop();
    for (const source of contexts[0].sources.slice(2)) source.onended?.();
    expect(stoppedEnded).not.toHaveBeenCalled();
  });

  it("reports post-limiter peak and the limiting flag", async () => {
    const { engine, contexts } = setup();
    const handle = await engine.play({ stems, soloStemId: null });
    const context = contexts[0];

    context.analyser!.samples = [0.1, -0.5, 0.25];
    context.compressor!.reduction = -0.5;
    expect(handle.level()).toEqual({ peak: 0.5, limiting: false });

    context.compressor!.reduction = -4;
    expect(handle.level().limiting).toBe(true);

    handle.stop();
    expect(handle.level()).toEqual({ peak: 0, limiting: false });
  });
});

describe("stemPreviewGain reference mode", () => {
  it("plays only the reference stem at unity, ignoring mute and solo", () => {
    const reference = { stemId: "original", gainDb: -12, muted: true };
    const vocals = { stemId: "vocals", gainDb: 0, muted: false };
    expect(stemPreviewGain(reference, null, "original")).toBe(1);
    expect(stemPreviewGain(reference, "vocals", "original")).toBe(1);
    expect(stemPreviewGain(vocals, null, "original")).toBe(0);
    expect(stemPreviewGain(vocals, "vocals", "original")).toBe(0);
    // Without a reference, the arrangement rules apply as before.
    expect(stemPreviewGain(reference, null)).toBe(0);
    expect(stemPreviewGain(vocals, null, null)).toBe(1);
  });
});
