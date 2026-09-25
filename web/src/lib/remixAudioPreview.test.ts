import { describe, expect, it, vi } from "vitest";
import {
  createStemPreviewEngine,
  loopEntryOffset,
  outputTimeIntervals,
  PREVIEW_WARMTH_INPUT_RANGE,
  sourcePositionAt,
  PREVIEW_LIMITER_RATIO,
  PREVIEW_LIMITER_THRESHOLD_DB,
  scheduleSectionEnvelopeFrom,
  sectionGainAt,
  stemPreviewGain,
  wrapLoopPosition,
} from "./remixAudioPreview";
import {
  biquadQDb,
  REMIX_FX_SCHEMA_VERSION,
  warmthCurve,
  type RemixFxRecipe,
} from "./remixFx";

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
  connections: unknown[] = [];
  disconnected = false;
  connect<T>(target: T): T {
    this.connections.push(target);
    return target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = new FakeParam();
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

class FakeBiquad extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeDelay extends FakeNode {
  delayTime = new FakeParam();
  constructor(public maxDelayTime: number) {
    super();
  }
}

class FakeConvolver extends FakeNode {
  normalize = true;
  buffer: unknown = null;
}

class FakeWaveShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = "4x";
}

class FakeAudioBuffer {
  channels: Float32Array[] = [];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  copyToChannel(data: Float32Array, channel: number) {
    this.channels[channel] = data;
  }
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "suspended";
  currentTime = 0;
  sampleRate = 48000;
  biquads: FakeBiquad[] = [];
  delays: FakeDelay[] = [];
  convolvers: FakeConvolver[] = [];
  shapers: FakeWaveShaper[] = [];
  audioBuffers: FakeAudioBuffer[] = [];
  createBiquadFilter() {
    const node = new FakeBiquad();
    this.biquads.push(node);
    return node;
  }
  createDelay(maxDelayTime: number) {
    const node = new FakeDelay(maxDelayTime);
    this.delays.push(node);
    return node;
  }
  createConvolver() {
    const node = new FakeConvolver();
    this.convolvers.push(node);
    return node;
  }
  createWaveShaper() {
    const node = new FakeWaveShaper();
    this.shapers.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.audioBuffers.push(buffer);
    return buffer;
  }
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

function fxRecipe(recipe: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe {
  return { schemaVersion: REMIX_FX_SCHEMA_VERSION, ...recipe };
}

/** source → manual gain → section gain. */
function sectionGainFromSource(source: FakeSource): FakeGain {
  const manual = source.connections[0] as FakeGain;
  return manual.connections[0] as FakeGain;
}

/** The gain nodes a node feeds, in connection order. */
function gainTargets(node: FakeNode): FakeGain[] {
  return node.connections.filter(
    (target): target is FakeGain => target instanceof FakeGain,
  );
}

describe("createStemPreviewEngine effects (#1897)", () => {
  it("keeps the plain graph when effects are null", async () => {
    for (const effects of [undefined, null]) {
      const { engine, contexts } = setup();
      await engine.play({ stems, soloStemId: null, effects });
      const context = contexts[0];
      // Exactly the pre-#1897 nodes: source, manual gain, section gain.
      expect(context.sources).toHaveLength(2);
      expect(context.gains).toHaveLength(4);
      expect(context.biquads).toHaveLength(0);
      expect(context.delays).toHaveLength(0);
      expect(context.convolvers).toHaveLength(0);
      expect(context.shapers).toHaveLength(0);
      expect(sectionGainOf(context, 0).connections).toEqual([
        context.compressor,
      ]);
      expect(context.sources[0].playbackRate.value).toBe(1);
    }
  });

  it("plays at varispeed and maps position back to source time", async () => {
    const { engine, contexts } = setup();
    const handle = await engine.play({
      stems,
      soloStemId: null,
      offsetSec: 12,
      effects: fxRecipe({ master: { speed: 1.25 } }),
    });
    const context = contexts[0];
    for (const source of context.sources) {
      expect(source.playbackRate.value).toBe(1.25);
      // The start offset stays in buffer (source) time.
      expect(source.start).toHaveBeenCalledWith(0.03, 12);
    }
    expect(handle.position()).toBe(12);
    context.currentTime = 0.03 + 4; // 4 output s = 5 source s
    expect(handle.position()).toBeCloseTo(17);
    context.currentTime = 1000;
    expect(handle.position()).toBe(60);
  });

  it("schedules section envelopes in output time", async () => {
    const { engine, contexts } = setup();
    const gated = [
      {
        stemId: "vocals",
        gainDb: 0,
        muted: false,
        activeIntervals: [{ startSec: 16, endSec: 32 }],
      },
    ];
    const effects = fxRecipe({ master: { speed: 0.8 } });
    await engine.play({ stems: gated, soloStemId: null, effects });
    const context = contexts[0];
    const fromZero = sectionGainFromSource(context.sources[0]).gain.events;
    expect(fromZero[0]).toEqual(["set", 0, 0.03]);
    expect(fromZero[1][0]).toBe("set");
    expect(fromZero[1][2]).toBeCloseTo(0.03 + 16 / 0.8);
    // Edge fades stay a fixed output-time length.
    expect(fromZero[2][2]).toBeCloseTo(0.03 + 16 / 0.8 + 0.05);
    expect(fromZero[4][2]).toBeCloseTo(0.03 + 32 / 0.8);

    await engine.play({
      stems: gated,
      soloStemId: null,
      offsetSec: 20,
      effects: fxRecipe({ master: { speed: 0.8 } }),
    });
    const events = sectionGainFromSource(context.sources[1]).gain.events;
    expect(events[0]).toEqual(["cancel", 0, 0.03]);
    expect(events[1]).toEqual(["set", 1, 0.03]);
    // Source 32 s plays (32 − 20)/0.8 = 15 output s after the start.
    expect(events[3][0]).toBe("ramp");
    expect(events[3][2]).toBeCloseTo(0.03 + 15);
  });

  it("builds explicit echo taps with the contract's delays and gains", async () => {
    const { engine, contexts } = setup();
    await engine.play({
      stems,
      soloStemId: null,
      bpm: 120,
      effects: fxRecipe({ stems: { vocals: { echo: 0.5 } } }),
    });
    const context = contexts[0];
    expect(context.delays).toHaveLength(8); // 4 taps per stem
    const vocalDelays = context.delays.slice(0, 4);
    expect(vocalDelays.map((delay) => delay.delayTime.value)).toEqual([
      0.375, 0.75, 1.125, 1.5,
    ]);
    const vocalTapGains = vocalDelays.map(
      (delay) => gainTargets(delay)[0].gain.value,
    );
    [0.25, 0.15, 0.09, 0.054].forEach((gain, index) => {
      expect(vocalTapGains[index]).toBeCloseTo(gain, 12);
    });
    for (const delay of context.delays.slice(4)) {
      expect(gainTargets(delay)[0].gain.value).toBe(0); // drums: no echo
    }
  });

  it("feeds a shared, non-normalized convolver through per-stem sends", async () => {
    const { engine, contexts } = setup();
    await engine.play({
      stems,
      soloStemId: null,
      effects: fxRecipe({
        master: { space: 0.6 },
        stems: { vocals: { space: 0.3 } },
      }),
    });
    const context = contexts[0];
    expect(context.convolvers).toHaveLength(1);
    const convolver = context.convolvers[0];
    expect(convolver.normalize).toBe(false);
    const impulse = convolver.buffer as FakeAudioBuffer;
    expect(impulse.numberOfChannels).toBe(2);
    expect(impulse.length).toBe(Math.round(2.8 * 48000));
    expect(impulse.channels[0][960]).toBeCloseTo(-0.003922798, 8);
    const sends = context.gains.filter((gain) =>
      gain.connections.includes(convolver),
    );
    expect(sends).toHaveLength(2);
    expect(sends[0].gain.value).toBeCloseTo(0.504, 12); // vocals
    expect(sends[1].gain.value).toBeCloseTo(0.42, 12); // drums: master only
    // The reverb returns into the master bus, ahead of master tone.
    const masterBus = convolver.connections[0] as FakeGain;
    expect(masterBus).toBeInstanceOf(FakeGain);
    expect(context.biquads.some((biquad) => masterBus.connections.includes(biquad))).toBe(true);

    // The IR is generated once per context.
    await engine.play({
      stems,
      soloStemId: null,
      effects: fxRecipe({ master: { space: 0.1 } }),
    });
    expect(context.audioBuffers).toHaveLength(1);
  });

  it("maps tone to biquads with WebAudio's dB Q", async () => {
    const { engine, contexts } = setup();
    await engine.play({
      stems: [stems[0]],
      soloStemId: null,
      effects: fxRecipe({
        master: { tone: 0.5 },
        stems: { vocals: { tone: -0.5 } },
      }),
    });
    const [masterTone, stemTone] = contexts[0].biquads;
    expect(stemTone.type).toBe("lowpass");
    expect(stemTone.frequency.value).toBeCloseTo(4000, 9);
    expect(stemTone.Q.value).toBeCloseTo(biquadQDb(0.7071), 12);
    expect(masterTone.type).toBe("highpass");
    expect(masterTone.frequency.value).toBeCloseTo(154.919333848, 8);
    // Filtered path on, dry path off.
    expect(gainTargets(stemTone)[0].gain.value).toBe(1);
  });

  it("shapes the master with the warmth curve, bypassed at 0", async () => {
    const { engine, contexts } = setup();
    const handle = await engine.play({
      stems: [stems[0]],
      soloStemId: null,
      effects: fxRecipe({ master: { warmth: 0.5 } }),
    });
    const context = contexts[0];
    const shaper = context.shapers[0];
    expect(shaper.oversample).toBe("none");
    expect(shaper.curve).toEqual(
      warmthCurve(0.5, 4096, PREVIEW_WARMTH_INPUT_RANGE),
    );
    const pre = context.gains.find((gain) => gain.connections.includes(shaper));
    expect(pre?.gain.value).toBe(1 / PREVIEW_WARMTH_INPUT_RANGE);
    const wet = gainTargets(shaper)[0];
    expect(wet.gain.value).toBe(1);
    expect(wet.connections).toEqual([context.compressor]);

    expect(
      handle.updateEffects(fxRecipe({ master: { tone: -0.2 } })),
    ).toBe("applied");
    expect(wet.gain.value).toBe(0);
  });

  it("updates tone, echo, space and warmth in place; speed restarts", async () => {
    const { engine, contexts } = setup();
    const handle = await engine.play({
      stems: [stems[0]],
      soloStemId: null,
      effects: fxRecipe({ master: { speed: 0.9 } }),
    });
    const context = contexts[0];
    const created = context.gains.length;
    expect(
      handle.updateEffects(
        fxRecipe({ master: { speed: 0.9, space: 1 }, stems: { vocals: { echo: 1 } } }),
      ),
    ).toBe("applied");
    expect(context.gains).toHaveLength(created); // no new nodes
    const send = context.gains.find((gain) =>
      gain.connections.includes(context.convolvers[0]),
    );
    expect(send?.gain.value).toBeCloseTo(0.7, 12);
    expect(gainTargets(context.delays[0])[0].gain.value).toBe(0.5);

    expect(handle.updateEffects(fxRecipe({ master: { speed: 1.1 } }))).toBe(
      "restart",
    );
    expect(
      handle.updateEffects(fxRecipe({ master: { speed: 0.9 } }), 128),
    ).toBe("restart");

    // A plain (null) preview needs a restart to gain effects…
    const plain = await engine.play({ stems: [stems[0]], soloStemId: null });
    expect(plain.updateEffects(null)).toBe("applied");
    expect(plain.updateEffects(fxRecipe({ master: { tone: 0.3 } }))).toBe(
      "restart",
    );
    // …while an effects preview at speed 1 clears in place (bypass).
    const fxHandle = await engine.play({
      stems: [stems[0]],
      soloStemId: null,
      effects: fxRecipe({ master: { tone: 0.3 } }),
    });
    expect(fxHandle.updateEffects(null)).toBe("applied");
  });
});

describe("createStemPreviewEngine effects tail (#1897)", () => {
  async function endAll(
    effects: RemixFxRecipe | null,
    bpm: number | null = null,
  ) {
    const { engine, contexts } = setup();
    const onEnded = vi.fn();
    const handle = await engine.play({
      stems,
      soloStemId: null,
      effects,
      bpm,
      onEnded,
    });
    const context = contexts[0];
    vi.useFakeTimers();
    context.currentTime = 100; // past the 60 s buffers
    for (const source of context.sources) source.onended?.();
    return { handle, context, onEnded };
  }

  it("holds the graph for the reverb tail before ending", async () => {
    try {
      const { handle, context, onEnded } = await endAll(
        fxRecipe({ master: { space: 0.3 }, stems: { vocals: { echo: 0.5 } } }),
        120,
      );
      // max(2.8 s reverb, 1.5 s last echo tap) = 2.8 s.
      expect(onEnded).not.toHaveBeenCalled();
      expect(context.convolvers[0].disconnected).toBe(false);
      expect(handle.position()).toBe(60); // clamped at the end
      vi.advanceTimersByTime(2799);
      expect(onEnded).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onEnded).toHaveBeenCalledTimes(1);
      expect(context.convolvers[0].disconnected).toBe(true);
      expect(handle.level()).toEqual({ peak: 0, limiting: false });
      expect(handle.position()).toBe(60);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds only the last echo tap without reverb", async () => {
    try {
      const { onEnded } = await endAll(
        fxRecipe({ stems: { vocals: { echo: 1 } } }),
      );
      vi.advanceTimersByTime(1499); // last tap at 4 × 0.375 s
      expect(onEnded).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onEnded).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends immediately with null effects or no tail", async () => {
    try {
      const plain = await endAll(null);
      expect(plain.onEnded).toHaveBeenCalledTimes(1);
      expect(plain.context.sources[0].disconnected).toBe(true);
      vi.useRealTimers();
      const speedOnly = await endAll(fxRecipe({ master: { speed: 0.9 } }));
      expect(speedOnly.onEnded).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases immediately when stopped during the tail", async () => {
    try {
      const { handle, context, onEnded } = await endAll(
        fxRecipe({ master: { space: 0.5 } }),
      );
      expect(context.convolvers[0].disconnected).toBe(false);
      handle.stop();
      expect(context.convolvers[0].disconnected).toBe(true);
      expect(handle.position()).toBe(60);
      vi.advanceTimersByTime(5000);
      expect(onEnded).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("varispeed helpers (#1897)", () => {
  it("scales section spans into output time", () => {
    expect(outputTimeIntervals(null, 0.5)).toBeNull();
    expect(outputTimeIntervals(undefined, 0.5)).toBeUndefined();
    const spans = [{ startSec: 8, endSec: 16 }];
    expect(outputTimeIntervals(spans, 1)).toBe(spans);
    expect(outputTimeIntervals(spans, 0.8)).toEqual([
      { startSec: 10, endSec: 20 },
    ]);
  });

  it("maps context time to source time", () => {
    expect(
      sourcePositionAt({ offsetSec: 10, startAt: 5, now: 4, speed: 0.85 }),
    ).toBe(10);
    expect(
      sourcePositionAt({ offsetSec: 10, startAt: 5, now: 9, speed: 0.85 }),
    ).toBeCloseTo(13.4);
  });
});
