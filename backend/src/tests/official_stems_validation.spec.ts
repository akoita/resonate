/**
 * Official stem package checks (#1976, ADR-TE-7) — pure unit tests: the rules
 * judge measurements, and the audio math is exercised on synthetic signals.
 */
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  bandEnvelopes,
  decodeMonoSamples,
  measurePartAgainstMix,
  measureSummedLevel,
  pearsonCorrelation,
  probeAudioFacts,
  rmsDb,
} from "../modules/ingestion/official-stems.audio";
import {
  OFFICIAL_STEM_MIN_ENVELOPE_CORRELATION,
  OFFICIAL_STEM_PART_OFFSET_MARGIN,
  OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB,
  isCompleteOfficialSet,
  isOfficialStemType,
  officialStemContainer,
  officialStemDurationToleranceSeconds,
  summarizeOfficialStemIssues,
  validateOfficialStemFiles,
  validateOfficialStemSilence,
  validatePartAlignment,
  validateSummedLevel,
  type OfficialStemCandidate,
  type PartAlignmentMeasure,
} from "../modules/ingestion/official-stems.validation";
import {
  FFMPEG_AVAILABLE,
  FIXTURE_SAMPLE_RATE,
  PART_NAMES,
  flacFromWav,
  flacHeaderBuffer,
  fullSong,
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

describe("partial packages (#2379)", () => {
  it("accepts any non-empty subset of the stem types, each part checked on its own", () => {
    expect(validateOfficialStemFiles({ mixDurationSeconds: 200, stems: [candidate("guitar")] })).toEqual([]);
    expect(
      validateOfficialStemFiles({ mixDurationSeconds: 200, stems: [candidate("bass"), candidate("piano", { container: "flac" })] }),
    ).toEqual([]);
  });

  it("lists the problem of every part, naming the part", () => {
    const issues = validateOfficialStemFiles({
      mixDurationSeconds: 200,
      stems: [
        candidate("vocals", { durationSeconds: 150 }),
        candidate("drums"),
        candidate("bass", { container: "mp3", lossless: false }),
      ],
    });
    expect(issues.map((issue) => [issue.code, issue.stemType])).toEqual([
      ["duration_mismatch", "vocals"],
      ["unsupported_format", "bass"],
    ]);
    expect(issues[0].message).toContain("vocals (vocals.wav)");
    expect(issues[1].message).toContain("bass (bass.wav)");
  });

  it("treats a package as complete only when it supplies every part the track is sold with", () => {
    const sold = ["bass", "drums", "vocals"];
    expect(isCompleteOfficialSet(["vocals", "drums", "bass"], sold)).toBe(true);
    expect(isCompleteOfficialSet(["vocals", "drums", "bass", "guitar"], sold)).toBe(true);
    expect(isCompleteOfficialSet(["vocals", "drums"], sold)).toBe(false);
    // Nothing known to be sold: nothing is compared with the sum.
    expect(isCompleteOfficialSet(["vocals", "drums", "bass"], [])).toBe(false);
  });
});

describe("per-part alignment rule", () => {
  const measure = (overrides: Partial<PartAlignmentMeasure> = {}): PartAlignmentMeasure => ({
    alignedCorrelation: 0.6,
    offsetCorrelation: 0.3,
    offsetFrames: 4,
    levelDifferenceDb: -8,
    ...overrides,
  });
  const part = { type: "vocals", fileName: "lead.wav" };

  it("passes a part that follows the mix and is quieter than it", () => {
    expect(validatePartAlignment(part, measure())).toEqual([]);
    // Barely under the margin: not a shift.
    expect(
      validatePartAlignment(part, measure({ alignedCorrelation: 0.4, offsetCorrelation: 0.4 + OFFICIAL_STEM_PART_OFFSET_MARGIN - 0.01 })),
    ).toEqual([]);
  });

  it("says how far a shifted part is and in which direction", () => {
    const late = validatePartAlignment(part, measure({ alignedCorrelation: 0.05, offsetCorrelation: 0.8, offsetFrames: 7 }));
    expect(late).toHaveLength(1);
    expect(late[0]).toEqual(expect.objectContaining({ code: "misaligned", stemType: "vocals" }));
    expect(late[0].message).toContain("vocals (lead.wav)");
    expect(late[0].message).toContain("0.7 s later");
    const early = validatePartAlignment(part, measure({ alignedCorrelation: 0.05, offsetCorrelation: 0.8, offsetFrames: -3 }));
    expect(early[0].message).toContain("0.3 s earlier");
  });

  it("refuses a part that follows nothing in the mix", () => {
    const issues = validatePartAlignment(part, measure({ alignedCorrelation: 0.01, offsetCorrelation: 0.1 }));
    expect(issues.map((issue) => issue.code)).toEqual(["misaligned"]);
    expect(issues[0].message).toContain("matches nothing");
  });

  it("refuses a part louder than the whole mix, and does not refuse a quiet one", () => {
    const loud = validatePartAlignment(part, measure({ levelDifferenceDb: OFFICIAL_STEM_SUMMED_LEVEL_TOLERANCE_DB + 3 }));
    expect(loud.map((issue) => issue.code)).toEqual(["part_louder_than_mix"]);
    expect(loud[0].message).toContain("9.0 dB louder");
    expect(validatePartAlignment(part, measure({ levelDifferenceDb: -40 }))).toEqual([]);
  });

  it("does not judge what it cannot measure (a short or near-silent part)", () => {
    expect(
      validatePartAlignment(part, measure({ alignedCorrelation: null, offsetCorrelation: null, offsetFrames: null })),
    ).toEqual([]);
  });
});

describe("per-part alignment on audio", () => {
  // Six parts with rhythms of their own at the analysis rate; see PART_SPECS in the fixtures.
  const RATE = 8_000;
  const seeds = [1, 2, 3];
  const songs = seeds.map((seed) => {
    const song = fullSong(20, seed, RATE);
    return { song, envelopes: bandEnvelopes(song.mix) };
  });
  const issuesFor = (index: number, name: (typeof PART_NAMES)[number], shiftSeconds = 0, gain = 0.9) => {
    const { song, envelopes } = songs[index];
    const samples = scaled(shiftSeconds ? shifted(song.parts[name], shiftSeconds, RATE) : song.parts[name], gain);
    return validatePartAlignment({ type: name, fileName: `${name}.wav` }, measurePartAgainstMix(song.mix, samples, envelopes));
  };

  it("passes every aligned part on its own, down to one 19 dB under the mix, and one 100 ms late", () => {
    for (let index = 0; index < songs.length; index += 1) {
      for (const name of PART_NAMES) {
        expect(issuesFor(index, name)).toEqual([]);
        expect(issuesFor(index, name, 0.1)).toEqual([]);
      }
    }
  });

  it("refuses a part exported 0.3 s or more late when it has a rhythm of its own", () => {
    for (let index = 0; index < songs.length; index += 1) {
      for (const name of ["vocals", "drums", "bass", "piano"] as const) {
        for (const delay of [0.3, 0.7]) {
          const issues = issuesFor(index, name, delay);
          expect(issues.map((issue) => issue.code)).toEqual(["misaligned"]);
          expect(issues[0].stemType).toBe(name);
        }
      }
    }
    // The message names the offset it found.
    expect(issuesFor(0, "bass", 0.7)[0].message).toContain("0.7 s later");
  });

  it("refuses a part that is louder than the whole mix (the mix itself with extra gain, another loud track)", () => {
    const { song, envelopes } = songs[0];
    const loud = validatePartAlignment(
      { type: "other", fileName: "other.wav" },
      measurePartAgainstMix(song.mix, scaled(song.mix, 3), envelopes),
    );
    expect(loud.map((issue) => issue.code)).toEqual(["part_louder_than_mix"]);
  });

  it("does not claim to recognise another track's part: a partial package cannot prove a part belongs to the mix", () => {
    // A part of a different song with the same instrumentation and beat grid can follow the mix as
    // well as a real part does (aligned correlations of 0.2 to 0.6 here), so the per-part rule is a
    // guard against shifts, wrong length and wrong level. Only a complete package's sum is held to
    // the mix. This pins that limit so a threshold change does not silently pretend otherwise.
    const { song, envelopes } = songs[0];
    const stranger = fullSong(20, 99, RATE).parts.vocals;
    const measured = measurePartAgainstMix(song.mix, scaled(stranger, 0.9), envelopes);
    expect(measured.alignedCorrelation as number).toBeGreaterThan(0.2);
  });

  it("judges nothing when there is too little audio", () => {
    const short = fullSong(2, 1, RATE);
    const measured = measurePartAgainstMix(short.mix, short.parts.vocals);
    expect(measured.alignedCorrelation).toBeNull();
    expect(validatePartAlignment({ type: "vocals", fileName: "v.wav" }, measured)).toEqual([]);
  });

  it("keeps the margin between aligned and shifted parts the thresholds rely on", () => {
    // The documented calibration: aligned parts (at most 100 ms off) never get near the margin.
    let largestAlignedGap = -Infinity;
    for (const { song, envelopes } of songs) {
      for (const name of PART_NAMES) {
        const measured = measurePartAgainstMix(song.mix, scaled(shifted(song.parts[name], 0.05, RATE), 0.9), envelopes);
        largestAlignedGap = Math.max(largestAlignedGap, (measured.offsetCorrelation as number) - (measured.alignedCorrelation as number));
      }
    }
    expect(largestAlignedGap).toBeLessThan(OFFICIAL_STEM_PART_OFFSET_MARGIN);
  });
});

// Without ffmpeg on PATH the block below is reported as skipped (the integration
// spec and the backend image both have ffmpeg, so CI still exercises it).
const describeWithFfmpeg = FFMPEG_AVAILABLE ? describe : describe.skip;
describeWithFfmpeg("real FLAC decode (needs ffmpeg on PATH)", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "official-stems-flac-spec-"));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const source = syntheticStems(3, FIXTURE_SAMPLE_RATE);

  it("reads the STREAMINFO of an encoded FLAC and accepts it as a lossless stem", () => {
    const flac = flacFromWav(wavBuffer(scaled(source.drums, 0.9), { channels: 2 }));
    expect(flac.toString("ascii", 0, 4)).toBe("fLaC");
    const facts = probeAudioFacts(flac);
    expect(facts).toEqual({ container: "flac", lossless: true, sampleRate: 44_100, channels: 2, durationSeconds: 3 });
    expect(
      validateOfficialStemFiles({
        mixDurationSeconds: 3,
        stems: [{ type: "drums", fileName: "drums.flac", size: flac.length, audio: facts }],
      }),
    ).toEqual([]);
  });

  it("reads the rate and channel count of a 24-bit 48 kHz mono FLAC", () => {
    const wav = wavBuffer(syntheticStems(2, 48_000).vocals, { sampleRate: 48_000, channels: 1 });
    const facts = probeAudioFacts(flacFromWav(wav, { bitDepth: 24 }));
    expect(facts).toEqual({ container: "flac", lossless: true, sampleRate: 48_000, channels: 1, durationSeconds: 2 });
  });

  it("decodes to the same samples as the WAV it was made from (lossless round trip)", async () => {
    const samples = scaled(source.vocals, 0.9);
    const wav = wavBuffer(samples);
    const flac = flacFromWav(wav);
    const wavPath = join(directory, "vocals.wav");
    const flacPath = join(directory, "vocals.flac");
    await writeFile(wavPath, wav);
    await writeFile(flacPath, flac);
    const fromWav = await decodeMonoSamples(wavPath);
    const fromFlac = await decodeMonoSamples(flacPath);
    expect(fromFlac.length).toBe(fromWav.length);
    expect(fromFlac.length).toBeCloseTo(3 * 8_000, -1);
    for (let i = 0; i < fromWav.length; i += 1) expect(fromFlac[i]).toBeCloseTo(fromWav[i], 5);
    expect(rmsDb(fromFlac)).toBeGreaterThan(-30);
    expect(flac.length).toBeLessThan(wav.length);
  });

  it("checks a FLAC part against the mix like a WAV part", async () => {
    const song = fullSong(20, 1, 44_100);
    const mixPath = join(directory, "mix.wav");
    const bassPath = join(directory, "bass.flac");
    await writeFile(mixPath, wavBuffer(song.mix));
    await writeFile(bassPath, flacFromWav(wavBuffer(scaled(song.parts.bass, 0.9))));
    const mix = await decodeMonoSamples(mixPath);
    const bass = await decodeMonoSamples(bassPath);
    expect(validatePartAlignment({ type: "bass", fileName: "bass.flac" }, measurePartAgainstMix(mix, bass))).toEqual([]);
    const late = await (async () => {
      const latePath = join(directory, "bass-late.flac");
      await writeFile(latePath, flacFromWav(wavBuffer(scaled(shifted(song.parts.bass, 0.7, 44_100), 0.9))));
      return decodeMonoSamples(latePath);
    })();
    expect(
      validatePartAlignment({ type: "bass", fileName: "bass-late.flac" }, measurePartAgainstMix(mix, late)).map((issue) => issue.code),
    ).toEqual(["misaligned"]);
  }, 60_000);
});
