/**
 * Official stem package checks (#1976, ADR-TE-7) — pure unit tests: the rules
 * judge measurements, and the audio math is exercised on synthetic signals.
 */
import {
  measureSummedLevel,
  pearsonCorrelation,
  probeAudioFacts,
  rmsDb,
} from "../modules/ingestion/official-stems.audio";
import {
  OFFICIAL_STEM_MIN_ENVELOPE_CORRELATION,
  OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB,
  isOfficialStemType,
  officialStemContainer,
  officialStemDurationToleranceSeconds,
  summarizeOfficialStemIssues,
  validateOfficialStemFiles,
  validateOfficialStemSilence,
  validateSummedLevel,
  type OfficialStemCandidate,
} from "../modules/ingestion/official-stems.validation";
import {
  FIXTURE_SAMPLE_RATE,
  flacHeaderBuffer,
  scaled,
  shifted,
  syntheticStems,
  wavBuffer,
} from "./official_stems_fixtures";

const goodAudio = {
  container: "wav",
  lossless: true,
  sampleRate: 44_100,
  channels: 2,
  durationSeconds: 200,
};
const candidate = (type: string, audio: Partial<typeof goodAudio> = {}): OfficialStemCandidate => ({
  type,
  fileName: `${type}.wav`,
  size: 1024,
  audio: { ...goodAudio, ...audio },
});
const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code);

describe("official stem types", () => {
  it("allows the six catalog stem types and nothing else", () => {
    for (const type of ["vocals", "drums", "bass", "guitar", "piano", "other"]) {
      expect(isOfficialStemType(type)).toBe(true);
    }
    for (const type of ["original", "master", "synth", "VOCALS", "", 3]) {
      expect(isOfficialStemType(type)).toBe(false);
    }
  });

  it("refuses an unknown type and a duplicated type with a readable reason", () => {
    const issues = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [candidate("synth"), candidate("drums"), candidate("drums")],
    });
    expect(codes(issues)).toEqual(["unknown_type", "duplicate_type"]);
    expect(issues[0].message).toContain("not a stem type");
  });

  it("refuses an empty package", () => {
    expect(codes(validateOfficialStemFiles({ mixDurationSeconds: 200, stems: [] }))).toEqual(["no_files"]);
  });
});

describe("official stem file rules", () => {
  it("accepts WAV and FLAC stems that match the mix", () => {
    expect(
      validateOfficialStemFiles({
        mixDurationSeconds: 200,
        stems: [candidate("vocals"), candidate("drums", { container: "flac" })],
      }),
    ).toEqual([]);
  });

  it("refuses a lossy file, a lossy codec inside WAV and an unknown format", () => {
    const issues = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [
        candidate("vocals", { container: "mp3", lossless: false }),
        candidate("drums", { container: "wav", lossless: false }),
        candidate("bass", { container: null as unknown as string, lossless: false }),
      ],
    });
    expect(codes(issues)).toEqual(["unsupported_format", "not_lossless", "unreadable_audio"]);
    expect(issues[0].message).toContain("must be WAV or FLAC");
    expect(issues[1].message).toContain("lossy");
  });

  it("refuses an empty, oversized or unreadable file", () => {
    const issues = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [
        { ...candidate("vocals"), size: 0 },
        { ...candidate("drums"), size: 301 * 1024 * 1024 },
        candidate("bass", { durationSeconds: null as unknown as number }),
      ],
    });
    expect(codes(issues)).toEqual(["empty_file", "file_too_large", "unreadable_audio"]);
  });

  it("checks the sample rate, the channel count and that the rate is shared", () => {
    expect(
      codes(validateOfficialStemFiles({ mixDurationSeconds: 200, stems: [candidate("vocals", { sampleRate: 22_050 })] })),
    ).toEqual(["unsupported_sample_rate"]);
    expect(
      codes(validateOfficialStemFiles({ mixDurationSeconds: 200, stems: [candidate("vocals", { channels: 6 })] })),
    ).toEqual(["unsupported_channels"]);
    const mixed = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [candidate("vocals", { sampleRate: 44_100 }), candidate("drums", { sampleRate: 48_000 })],
    });
    expect(codes(mixed)).toEqual(["mixed_sample_rates"]);
    expect(mixed[0].message).toContain("44100, 48000");
  });

  it("accepts a duration within the tolerance of the mix and refuses one outside it", () => {
    expect(officialStemDurationToleranceSeconds(10)).toBe(0.5);
    expect(officialStemDurationToleranceSeconds(200)).toBeCloseTo(1, 6);
    const near = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [candidate("vocals", { durationSeconds: 200.9 }), candidate("drums", { durationSeconds: 199.1 })],
    });
    expect(near).toEqual([]);
    const far = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [candidate("vocals", { durationSeconds: 203 })],
    });
    expect(codes(far)).toEqual(["duration_mismatch"]);
    expect(far[0].message).toContain("203.0 s");
    expect(far[0].message).toContain("200.0 s");
    expect(far[0].stemType).toBe("vocals");
  });

  it("flags a silent stem once its level is measured", () => {
    const silent = { ...candidate("vocals"), rmsDb: -90 };
    const fine = { ...candidate("drums"), rmsDb: -20 };
    expect(codes(validateOfficialStemSilence([silent, fine]))).toEqual(["silent_stem"]);
  });

  it("summarizes the first problem and counts the rest", () => {
    const issues = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [candidate("vocals", { sampleRate: 22_050 }), candidate("drums", { channels: 6 })],
    });
    expect(summarizeOfficialStemIssues(issues)).toMatch(/Hz\. Use .* \(and 1 more problem\)$/);
    expect(summarizeOfficialStemIssues([])).toBe("");
  });
});

describe("summed-level check", () => {
  // The service measures audio decoded to 8 kHz mono; so do these tests.
  const RATE = 8_000;
  const stems = syntheticStems(4, RATE);
  const parts = [stems.vocals, stems.drums, stems.bass];

  it("passes stems that add up to the mix and measures them", () => {
    const measure = measureSummedLevel(stems.mix, parts.map((part) => scaled(part, 0.9)));
    expect(Math.abs(measure.differenceDb)).toBeLessThan(0.5);
    expect(measure.envelopeCorrelation).toBeGreaterThan(0.95);
    expect(validateSummedLevel(measure)).toEqual([]);
  });

  it("passes a master bus that moved the level a few dB", () => {
    const measure = measureSummedLevel(stems.mix, parts.map((part) => scaled(part, 0.9 * 1.6)));
    expect(measure.differenceDb).toBeGreaterThan(3);
    expect(validateSummedLevel(measure)).toEqual([]);
  });

  it("refuses stems far louder than the mix (the mix itself, or another track)", () => {
    const measure = measureSummedLevel(stems.mix, [...parts, stems.mix].map((part) => scaled(part, 2)));
    const issues = validateSummedLevel(measure);
    expect(codes(issues)).toContain("summed_level_mismatch");
    expect(issues.find((issue) => issue.code === "summed_level_mismatch")?.message).toContain("louder");
  });

  it("refuses a package missing most of the track (too quiet)", () => {
    const measure = measureSummedLevel(stems.mix, [scaled(stems.bass, 0.9)]);
    const issues = validateSummedLevel(measure);
    expect(measure.differenceDb).toBeLessThan(-OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB);
    expect(issues[0].code).toBe("summed_level_mismatch");
    expect(issues[0].message).toContain("quieter");
    expect(issues[0].message).toContain("missing stems");
  });

  it("refuses stems shifted against the mix even when the level matches", () => {
    const measure = measureSummedLevel(
      stems.mix,
      parts.map((part) => scaled(shifted(part, 0.25, RATE), 0.9)),
    );
    expect(Math.abs(measure.differenceDb)).toBeLessThan(OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB);
    expect(measure.envelopeCorrelation).not.toBeNull();
    expect(measure.envelopeCorrelation as number).toBeLessThan(OFFICIAL_STEM_MIN_ENVELOPE_CORRELATION);
    expect(codes(validateSummedLevel(measure))).toEqual(["misaligned"]);
  });

  it("does not judge alignment against a flat mix", () => {
    const flat = new Float32Array(FIXTURE_SAMPLE_RATE).fill(0.1);
    expect(measureSummedLevel(flat, [flat]).envelopeCorrelation).toBeNull();
    expect(validateSummedLevel({ mixRmsDb: -20, summedRmsDb: -20, differenceDb: 0, envelopeCorrelation: null })).toEqual([]);
  });

  it("measures levels and correlations", () => {
    expect(rmsDb(new Float32Array(100))).toBe(-120);
    expect(rmsDb(new Float32Array(100).fill(1))).toBeCloseTo(0, 6);
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
    expect(pearsonCorrelation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 6);
    expect(pearsonCorrelation([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearsonCorrelation([1], [1])).toBeNull();
  });
});

describe("header probe", () => {
  it("reads a WAV: rate, channels, duration and that PCM is lossless", () => {
    const facts = probeAudioFacts(wavBuffer(new Float32Array(FIXTURE_SAMPLE_RATE * 2), { channels: 2 }));
    expect(facts).toEqual({
      container: "wav",
      lossless: true,
      sampleRate: 44_100,
      channels: 2,
      durationSeconds: 2,
    });
  });

  it("treats a compressed codec inside a WAV container as lossy", () => {
    const facts = probeAudioFacts(wavBuffer(new Float32Array(1000), { formatTag: 0x55 }));
    expect(facts.container).toBe("wav");
    expect(facts.lossless).toBe(false);
  });

  it("reads a FLAC STREAMINFO block", () => {
    const facts = probeAudioFacts(flacHeaderBuffer({ sampleRate: 48_000, channels: 2, totalSamples: 96_000 }));
    expect(facts).toEqual({
      container: "flac",
      lossless: true,
      sampleRate: 48_000,
      channels: 2,
      durationSeconds: 2,
    });
  });

  it("names other formats and never throws on junk", () => {
    expect(probeAudioFacts(Buffer.from("ID3\u0004rest")).container).toBe("mp3");
    expect(probeAudioFacts(Buffer.from([0xff, 0xfb, 0x90, 0x00])).container).toBe("mp3");
    expect(probeAudioFacts(Buffer.from("OggS....")).container).toBe("ogg");
    const junk = probeAudioFacts(Buffer.from("not audio at all"));
    expect(junk).toEqual({ container: null, lossless: false, sampleRate: null, channels: null, durationSeconds: null });
    expect(probeAudioFacts(Buffer.alloc(0)).container).toBeNull();
    expect(probeAudioFacts(Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVE")).durationSeconds).toBeNull();
  });

  it("maps parser container names to the accepted two", () => {
    expect(officialStemContainer("WAVE")).toBe("wav");
    expect(officialStemContainer("flac")).toBe("flac");
    expect(officialStemContainer("mp3")).toBeNull();
    expect(officialStemContainer(null)).toBeNull();
  });
});
