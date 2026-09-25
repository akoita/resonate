import { describe, expect, it, vi } from "vitest";
import {
  createStemPreviewEngine,
  loopEntryOffset,
  PREVIEW_LIMITER_RATIO,
  PREVIEW_LIMITER_THRESHOLD_DB,
  scheduleSectionEnvelopeFrom,
  sectionGainAt,
  stemPreviewGain,
  wrapLoopPosition,
} from "./remixAudioPreview";

/**
 * Minimal fake WebAudio graph: enough surface for the preview engine to wire
 * sources → gains → limiter → analyser → destination and for tests to poke
 * the limiter's reduction and the analyser's samples.
 */
class FakeParam {
  value = 1;
  events: Array<[string, number, number]> = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push(["set", value, time]);
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push(["ramp", value, time]);
    return this;
  }
  cancelScheduledValues(time: number) {
    this.events.push(["cancel", 0, time]);
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
  loop = false;
  loopStart = 0;
  loopEnd = 0;
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
  gains: FakeGain[] = [];
  /** Decoded buffer length in seconds (every stem, unless overridden). */
  bufferSeconds = 60;
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({
    decodedFrom: data,
    duration: this.bufferSeconds,
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
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
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

/** Each stem gets [manual gain, section gain] in creation order. */
function sectionGainOf(context: FakeAudioContext, stemIndex: number) {
  return context.gains[stemIndex * 2 + 1];
}

describe("createStemPreviewEngine preload (#1879)", () => {
  it("decodes into the play cache without resuming, reporting each stem", async () => {
    const { engine, fetchImpl, contexts } = setup();
    const loaded = vi.fn();
    await engine.preload(["vocals", "drums"], loaded);

    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).not.toHaveBeenCalled();
    expect(loaded.mock.calls.map(([stemId]) => stemId).sort()).toEqual([
      "drums",
      "vocals",
    ]);
    expect(engine.bufferDuration()).toBe(60);
    expect(engine.bufferDuration(["vocals"])).toBe(60);
    expect(engine.bufferDuration(["unknown"])).toBeNull();

    // Already cached: reported again, not re-fetched; play reuses it.
    await engine.preload(["vocals"], loaded);
    expect(loaded).toHaveBeenCalledTimes(3);
    await engine.play({ stems, soloStemId: null });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("swallows per-stem failures and retries them later", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValue(okResponse());
    const { engine } = setup(fetchImpl);
    const loaded = vi.fn();
    await expect(engine.preload(["vocals"], loaded)).resolves.toBeUndefined();
    expect(loaded).not.toHaveBeenCalled();
    expect(engine.bufferDuration()).toBeNull();

    await engine.preload(["vocals"], loaded);
    expect(loaded).toHaveBeenCalledWith("vocals", expect.anything());
  });

  it("never rejects without WebAudio", async () => {
    const engine = createStemPreviewEngine({
      urlForStem: (stemId) => `/stems/${stemId}`,
      audioContextFactory: () => {
        throw new Error("no audio");
      },
    });
    await expect(engine.preload(["vocals"])).resolves.toBeUndefined();
  });
});

describe("createStemPreviewEngine offsets and loops (#1879)", () => {
  it("starts every source at the seek offset and tracks position", async () => {
    const { engine, contexts } = setup();
    const handle = await engine.play({ stems, soloStemId: null, offsetSec: 12 });
    const context = contexts[0];
    for (const source of context.sources) {
      expect(source.start).toHaveBeenCalledWith(0.03, 12);
      expect(source.loop).toBe(false);
    }
    expect(handle.duration()).toBe(60);
    // Before the scheduled start the playhead sits on the offset.
    expect(handle.position()).toBe(12);
    context.currentTime = 5.03;
    expect(handle.position()).toBeCloseTo(17);
    context.currentTime = 500;
    expect(handle.position()).toBe(60); // clamped to the audio
    context.currentTime = 10.03;
    handle.stop();
    context.currentTime = 20;
    expect(handle.position()).toBeCloseTo(22); // frozen at stop
  });

  it("keeps the from-zero envelope identical and offsets it otherwise", async () => {
    const { engine, contexts } = setup();
    const gated = [
      {
        stemId: "vocals",
        gainDb: 0,
        muted: false,
        activeIntervals: [{ startSec: 16, endSec: 32 }],
      },
    ];
    await engine.play({ stems: gated, soloStemId: null });
    expect(sectionGainOf(contexts[0], 0).gain.events[0]).toEqual([
      "set",
      0,
      0.03,
    ]);

    await engine.play({ stems: gated, soloStemId: null, offsetSec: 20 });
    const events = sectionGainOf(contexts[0], 1).gain.events;
    // Timeline zero = 0.03 - 20; inside the span → 1 now, fade-out later.
    expect(events[0]).toEqual(["cancel", 0, 0.03]);
    expect(events[1]).toEqual(["set", 1, 0.03]);
    expect(events.slice(2).map(([kind, value]) => [kind, value])).toEqual([
      ["set", 1],
      ["ramp", 0],
    ]);
    expect(events[3][2]).toBeCloseTo(0.03 - 20 + 32);
  });

  it("loops with constant midpoint section gains and never ends", async () => {
    const { engine, contexts } = setup();
    const onEnded = vi.fn();
    const handle = await engine.play({
      stems: [
        {
          stemId: "vocals",
          gainDb: 0,
          muted: false,
          activeIntervals: [{ startSec: 0, endSec: 16 }],
        },
        {
          stemId: "drums",
          gainDb: 0,
          muted: false,
          activeIntervals: [{ startSec: 16, endSec: 32 }],
        },
      ],
      soloStemId: null,
      offsetSec: 40, // outside the loop → enters at the loop start
      loop: { startSec: 16, endSec: 32 },
      onEnded,
    });
    const context = contexts[0];
    for (const source of context.sources) {
      expect(source.loop).toBe(true);
      expect(source.loopStart).toBe(16);
      expect(source.loopEnd).toBe(32);
      expect(source.start).toHaveBeenCalledWith(0.03, 16);
    }
    expect(sectionGainOf(context, 0).gain.value).toBe(0);
    expect(sectionGainOf(context, 1).gain.value).toBe(1);
    // Only the constant is scheduled — no boundaries inside a loop.
    expect(sectionGainOf(context, 1).gain.events).toEqual([
      ["cancel", 0, 0.03],
      ["set", 1, 0.03],
    ]);

    context.currentTime = 0.03 + 20; // 16 + 20 = 36 → wraps to 20
    expect(handle.position()).toBeCloseTo(20);

    for (const source of context.sources) source.onended?.();
    expect(onEnded).not.toHaveBeenCalled();

    // Live cell edits only recompute the constant.
    handle.updateSections([
      {
        stemId: "vocals",
        gainDb: 0,
        muted: false,
        activeIntervals: null,
      },
    ]);
    expect(sectionGainOf(context, 0).gain.value).toBe(1);
  });

  it("clamps the loop to the audio and ignores degenerate loops", async () => {
    const { engine, contexts } = setup();
    await engine.play({
      stems: [stems[0]],
      soloStemId: null,
      loop: { startSec: 50, endSec: 90 },
    });
    expect(contexts[0].sources[0].loopEnd).toBe(60);

    await engine.play({
      stems: [stems[0]],
      soloStemId: null,
      loop: { startSec: 70, endSec: 90 },
    });
    expect(contexts[0].sources[1].loop).toBe(false);
  });

  it("re-schedules section envelopes live from the current position", async () => {
    const { engine, contexts } = setup();
    const handle = await engine.play({ stems: [stems[0]], soloStemId: null });
    const context = contexts[0];
    context.currentTime = 10.03; // position 10
    const param = sectionGainOf(context, 0).gain;
    param.events = [];
    handle.updateSections([
      { ...stems[0], activeIntervals: [{ startSec: 32, endSec: 48 }] },
    ]);
    expect(param.events[0]).toEqual(["cancel", 0, 10.03]);
    expect(param.events[1]).toEqual(["set", 0, 10.03]);
    expect(param.events[2][0]).toBe("set");
    expect(param.events[2][2]).toBeCloseTo(0.03 + 32);

    handle.stop();
    param.events = [];
    handle.updateSections([{ ...stems[0], activeIntervals: [] }]);
    expect(param.events).toEqual([]);
  });
});

describe("scheduleSectionEnvelopeFrom (#1879)", () => {
  function recorder() {
    const events: Array<[string, number, number]> = [];
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      events,
      param: {
        cancelScheduledValues: (time: number) => {
          events.push(["cancel", 0, round(time)]);
        },
        setValueAtTime: (value: number, time: number) => {
          events.push(["set", value, round(time)]);
        },
        linearRampToValueAtTime: (value: number, time: number) => {
          events.push(["ramp", value, round(time)]);
        },
      },
    };
  }
  const spans = [
    { startSec: 0, endSec: 32 },
    { startSec: 48, endSec: 64 },
  ];

  it("holds 1 for whole stems and 0 for silent ones", () => {
    const whole = recorder();
    scheduleSectionEnvelopeFrom(whole.param, null, 100, 10, 110);
    expect(whole.events).toEqual([
      ["cancel", 0, 110],
      ["set", 1, 110],
    ]);
    const undefinedSpans = recorder();
    scheduleSectionEnvelopeFrom(undefinedSpans.param, undefined, 100, 10, 110);
    expect(undefinedSpans.events[1]).toEqual(["set", 1, 110]);

    const silent = recorder();
    scheduleSectionEnvelopeFrom(silent.param, [], 100, 10, 110);
    expect(silent.events).toEqual([
      ["cancel", 0, 110],
      ["set", 0, 110],
    ]);
  });

  it("starts inside a span at 1 and schedules only later boundaries", () => {
    const { param, events } = recorder();
    scheduleSectionEnvelopeFrom(param, spans, 100, 10, 110, 0.05);
    expect(events).toEqual([
      ["cancel", 0, 110],
      ["set", 1, 110],
      ["set", 1, 131.95],
      ["ramp", 0, 132],
      ["set", 0, 148],
      ["ramp", 1, 148.05],
      ["set", 1, 163.95],
      ["ramp", 0, 164],
    ]);
  });

  it("starts outside a span at 0 and skips past boundaries", () => {
    const { param, events } = recorder();
    scheduleSectionEnvelopeFrom(param, spans, 100, 40, 140, 0.05);
    expect(events).toEqual([
      ["cancel", 0, 140],
      ["set", 0, 140],
      ["set", 0, 148],
      ["ramp", 1, 148.05],
      ["set", 1, 163.95],
      ["ramp", 0, 164],
    ]);
  });

  it("keeps a mid-fade ramp so the fade finishes from the pinned level", () => {
    const { param, events } = recorder();
    scheduleSectionEnvelopeFrom(param, spans, 100, 31.97, 131.97, 0.05);
    expect(events.slice(0, 3)).toEqual([
      ["cancel", 0, 131.97],
      ["set", 1, 131.97],
      ["ramp", 0, 132],
    ]);
  });
});

describe("loop helpers (#1879)", () => {
  const loop = { startSec: 16, endSec: 32 };
  it("enters a loop at the offset only when it lies inside", () => {
    expect(loopEntryOffset(20, loop)).toBe(20);
    expect(loopEntryOffset(16, loop)).toBe(16);
    expect(loopEntryOffset(32, loop)).toBe(16);
    expect(loopEntryOffset(4, loop)).toBe(16);
  });

  it("wraps positions past the loop end", () => {
    expect(wrapLoopPosition(20, loop)).toBe(20);
    expect(wrapLoopPosition(32, loop)).toBe(16);
    expect(wrapLoopPosition(52, loop)).toBe(20);
  });

  it("reads the section gain at a timeline position", () => {
    expect(sectionGainAt(null, 5)).toBe(1);
    expect(sectionGainAt([], 5)).toBe(0);
    expect(sectionGainAt([{ startSec: 0, endSec: 16 }], 5)).toBe(1);
    expect(sectionGainAt([{ startSec: 0, endSec: 16 }], 16)).toBe(0);
  });
});

describe("createStemPreviewEngine decode (#1879)", () => {
  it("decodes on the shared context without resuming or touching the stem cache", async () => {
    const { engine, fetchImpl, contexts } = setup();
    const data = new ArrayBuffer(16);
    const buffer = await engine.decode(data);

    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).not.toHaveBeenCalled();
    expect(contexts[0].decodeAudioData).toHaveBeenCalledWith(data);
    expect((buffer as unknown as { decodedFrom: ArrayBuffer }).decodedFrom).toBe(
      data,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(engine.bufferDuration()).toBeNull();

    // Same context for later stem work.
    await engine.preload(["vocals"]);
    expect(contexts).toHaveLength(1);
  });

  it("rejects once disposed", async () => {
    const { engine } = setup();
    engine.dispose();
    await expect(engine.decode(new ArrayBuffer(4))).rejects.toThrow(/disposed/);
  });
});
