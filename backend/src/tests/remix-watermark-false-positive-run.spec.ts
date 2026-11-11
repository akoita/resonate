import {
  runRemixWatermarkFalsePositiveCheck,
  type FalsePositiveRunDetector,
} from "../modules/remix/remix-watermark-false-positive-run";
import {
  inverseSearchShifts,
  type RemixWatermarkCandidate,
  type RemixWatermarkDetectStage,
  type RemixWatermarkShift,
} from "../modules/remix/remix-watermark-detect";

const STORED = "a".repeat(32);
const OTHER = "b".repeat(32);

function candidate(
  payload: string,
  stage: RemixWatermarkDetectStage,
  keyId = "k1",
): RemixWatermarkCandidate {
  return { payload, keyId, keySlot: "active", stage, occurrences: 1, decodeError: 0, syncQuality: 0.2 };
}

function fakeDetector(
  byStage: Partial<Record<RemixWatermarkDetectStage, RemixWatermarkCandidate[]>>,
  overrides: Partial<FalsePositiveRunDetector> = {},
): FalsePositiveRunDetector & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    decodeClip: async () => {
      calls.push("decode");
    },
    candidates: async (_wav, stage) => {
      calls.push(stage);
      return byStage[stage] ?? [];
    },
    inverseCandidates: async (_wav, shift: RemixWatermarkShift) => {
      calls.push(`inverse:${shift.kind}:${shift.amount}`);
      return (byStage.inverse ?? []).map((found) => ({ ...found, shift }));
    },
    ...overrides,
  };
}

const lookup = async (payloads: string[]) =>
  payloads.filter((payload) => payload === STORED).map((token) => ({ token, keyId: "k1" }));

const entry = (label: string, audio: Buffer | null = Buffer.from("audio")) => ({
  label,
  load: async () => audio,
});

describe("runRemixWatermarkFalsePositiveCheck", () => {
  it("counts decoded payloads and reports no hit when none is stored", async () => {
    const detector = fakeDetector({
      plain: [candidate(OTHER, "plain"), candidate(OTHER, "plain")],
      speed: [candidate("c".repeat(32), "speed")],
    });
    const report = await runRemixWatermarkFalsePositiveCheck({
      entries: [entry("one"), entry("two")],
      detector,
      lookup,
    });
    expect(report).toMatchObject({
      depth: "speed",
      listed: 2,
      checked: 2,
      skipped: [],
      hits: [],
      candidatesDecoded: { plain: 2, speed: 2, inverse: 0 },
    });
    expect(detector.calls.filter((call) => call.startsWith("inverse"))).toEqual([]);
  });

  it("reports a clip whose payload equals a stored token of the same key", async () => {
    const report = await runRemixWatermarkFalsePositiveCheck({
      entries: [entry("clean"), entry("hit")],
      detector: fakeDetector({ speed: [candidate(STORED, "speed")] }),
      lookup,
    });
    expect(report.hits).toEqual([
      { label: "clean", stage: "speed", keyId: "k1" },
      { label: "hit", stage: "speed", keyId: "k1" },
    ]);
    expect(JSON.stringify(report)).not.toContain(STORED);
  });

  it("ignores a stored token decoded with a different key", async () => {
    const report = await runRemixWatermarkFalsePositiveCheck({
      entries: [entry("one")],
      detector: fakeDetector({ plain: [candidate(STORED, "plain", "k2")] }),
      lookup,
    });
    expect(report.hits).toEqual([]);
    expect(report.checked).toBe(1);
  });

  it("runs only the plain stage at depth plain", async () => {
    const detector = fakeDetector({ speed: [candidate(STORED, "speed")] });
    const report = await runRemixWatermarkFalsePositiveCheck({
      entries: [entry("one")],
      detector,
      lookup,
      depth: "plain",
    });
    expect(detector.calls).toEqual(["decode", "plain"]);
    expect(report.hits).toEqual([]);
  });

  it("walks the pitch and tempo search at depth full and names the shift", async () => {
    const detector = fakeDetector({ inverse: [candidate(STORED, "inverse")] });
    const report = await runRemixWatermarkFalsePositiveCheck({
      entries: [entry("one")],
      detector,
      lookup,
      depth: "full",
    });
    expect(report.hits).toEqual([
      { label: "one", stage: "inverse", keyId: "k1", shift: inverseSearchShifts()[0] },
    ]);
    expect(detector.calls.filter((call) => call.startsWith("inverse"))).toHaveLength(1);
  });

  it("skips missing audio, undecodable audio and detector errors without stopping", async () => {
    let n = 0;
    const detector = fakeDetector(
      {},
      {
        decodeClip: async () => {
          n += 1;
          if (n === 1) throw new Error("not audio");
        },
        candidates: async () => {
          if (n === 2) throw new Error("detector died");
          return [];
        },
      },
    );
    const progress: string[] = [];
    const report = await runRemixWatermarkFalsePositiveCheck({
      entries: [
        entry("gone", null),
        entry("garbage"),
        entry("crash"),
        entry("fine"),
        { label: "rejected", load: () => Promise.reject(new Error("bad uri")) },
      ],
      detector,
      lookup,
      onProgress: (done, total, label) => progress.push(`${done}/${total} ${label}`),
    });
    expect(report.skipped).toEqual([
      { label: "gone", reason: "missing" },
      { label: "garbage", reason: "decode_failed" },
      { label: "crash", reason: "detector_failed" },
      { label: "rejected", reason: "missing" },
    ]);
    expect(report.checked).toBe(1);
    expect(progress).toEqual([
      "1/5 gone",
      "2/5 garbage",
      "3/5 crash",
      "4/5 fine",
      "5/5 rejected",
    ]);
  });
});
