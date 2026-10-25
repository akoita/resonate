/**
 * Purpose-made demo song for the User Guide audio examples (#1943).
 *
 * "Resonate Help Demo" is synthesized from scratch, sample by sample, with no
 * recordings, samples, loops, catalog audio or AI models involved: every
 * stem is plain arithmetic (sine/saw additions, filtered noise, envelopes)
 * seeded with fixed constants, so it is rights-clean and re-creatable on any
 * machine. Provenance and licence: web/public/help/audio/PROVENANCE.md.
 *
 * Four stems, as a separated song would have them: vocals, drums, bass and
 * other (chords). 180 BPM written as a half-time groove (it feels like 90),
 * A minor, 24 bars = 32 s = exactly three 8-bar Remix Studio sections.
 */

export const DEMO_SAMPLE_RATE = 48_000;
export const DEMO_BPM = 180;
export const DEMO_BARS = 24;
export const DEMO_BEATS_PER_BAR = 4;
export const DEMO_BEAT_SEC = 60 / DEMO_BPM;
export const DEMO_BAR_SEC = DEMO_BEAT_SEC * DEMO_BEATS_PER_BAR;
export const DEMO_DURATION_SEC = DEMO_BARS * DEMO_BAR_SEC;
export const DEMO_KEY = { tonic: "A", mode: "minor" as const };

export type DemoStemName = "vocals" | "drums" | "bass" | "other";
export const DEMO_STEM_NAMES: readonly DemoStemName[] = ["vocals", "drums", "bass", "other"];

export type DemoStem = {
  name: DemoStemName;
  /** Two channels (L, R) of 48 kHz float audio, DEMO_DURATION_SEC long. */
  channels: Float32Array[];
};

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

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** One chord per bar; the four-bar loop is Am | F | C | G. */
const PROGRESSION = [
  { root: 33, pad: [57, 60, 64] }, // Am: A1 bass; A3 C4 E4
  { root: 29, pad: [57, 60, 65] }, // F: F1; A3 C4 F4
  { root: 36, pad: [55, 60, 64] }, // C: C2; G3 C4 E4
  { root: 31, pad: [55, 59, 62] }, // G: G1; G3 B3 D4
] as const;

const frames = Math.round(DEMO_DURATION_SEC * DEMO_SAMPLE_RATE);
const sec = (t: number) => Math.round(t * DEMO_SAMPLE_RATE);

function emptyStereo(): Float32Array[] {
  return [new Float32Array(frames), new Float32Array(frames)];
}

/** Scale a stereo buffer so its peak is `target`. */
function normalizePeak(channels: Float32Array[], target: number): void {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
  }
  if (peak === 0) return;
  const gain = target / peak;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) channel[i] *= gain;
  }
}

/** Add `render(x)` for x = seconds since `startSec`, over `lengthSec`, with equal-power pan. */
function addVoice(
  out: Float32Array[],
  startSec: number,
  lengthSec: number,
  render: (x: number, i: number) => number,
  pan = 0,
): void {
  const start = sec(startSec);
  const length = sec(lengthSec);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < length; i += 1) {
    const idx = start + i;
    if (idx < 0) continue;
    if (idx >= frames) break;
    const v = render(i / DEMO_SAMPLE_RATE, i);
    out[0][idx] += v * gl;
    out[1][idx] += v * gr;
  }
}

// --- drums -----------------------------------------------------------------------------------

function synthDrums(): Float32Array[] {
  const out = emptyStereo();
  const rng = mulberry32(1943);
  const beat = DEMO_BEAT_SEC;

  const kick = (t: number, level: number) =>
    addVoice(out, t, 0.4, (x) => {
      const phase = 2 * Math.PI * (45 * x + (75 / 28) * (1 - Math.exp(-28 * x)));
      const click = x < 0.004 ? (rng() * 2 - 1) * 0.25 : 0;
      return level * (Math.sin(phase) * Math.exp(-x / 0.16) + click);
    });
  const snare = (t: number, level: number) => {
    let low = 0;
    addVoice(
      out,
      t,
      0.35,
      (x) => {
        const noise = rng() * 2 - 1;
        low += 0.45 * (noise - low); // soften the noise a little
        const body = Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x / 0.07);
        return level * (0.5 * low * Math.exp(-x / 0.09) + 0.55 * body);
      },
      0.05,
    );
  };
  const hat = (t: number, level: number, decay: number, pan: number) => {
    let previous = 0;
    let smooth = 0;
    addVoice(
      out,
      t,
      decay * 6,
      (x) => {
        const noise = rng() * 2 - 1;
        const high = noise - previous; // first-difference high-pass
        previous = noise;
        smooth += 0.55 * (high - smooth); // tame the very top so the hats are not harsh
        return level * smooth * Math.exp(-x / decay);
      },
      pan,
    );
  };

  for (let bar = 0; bar < DEMO_BARS; bar += 1) {
    const t0 = bar * DEMO_BAR_SEC;
    const intro = bar < 4;
    // hats on every eighth; the off-beat eighths are a little open and louder
    for (let eighth = 0; eighth < 8; eighth += 1) {
      const t = t0 + eighth * (beat / 2);
      const offbeat = eighth % 2 === 1;
      hat(t, offbeat ? 0.11 : 0.07, offbeat ? 0.05 : 0.025, offbeat ? 0.25 : -0.2);
    }
    if (intro) {
      if (bar % 2 === 0) kick(t0, 0.9);
      continue;
    }
    // half-time groove: kick on 1 and the "and" of 2, snare on 3
    kick(t0, 1);
    kick(t0 + beat * 1.5, 0.75);
    snare(t0 + beat * 2, 0.8);
    if (bar % 4 === 3) kick(t0 + beat * 3.5, 0.6);
  }
  normalizePeak(out, 0.7);
  return out;
}

// --- bass ------------------------------------------------------------------------------------

function synthBass(): Float32Array[] {
  const out = emptyStereo();
  const beat = DEMO_BEAT_SEC;
  const note = (t: number, midi: number, lengthBeats: number, level: number) => {
    const hz = midiToHz(midi);
    const length = lengthBeats * beat;
    addVoice(out, t, length + 0.05, (x) => {
      const attack = Math.min(1, x / 0.006);
      const release = x > length ? Math.max(0, 1 - (x - length) / 0.05) : 1;
      const decay = 0.55 + 0.45 * Math.exp(-x / 0.5);
      const wave =
        Math.sin(2 * Math.PI * hz * x) + 0.35 * Math.sin(4 * Math.PI * hz * x + 0.4);
      return level * attack * release * decay * Math.tanh(1.6 * wave);
    });
  };
  for (let bar = 0; bar < DEMO_BARS; bar += 1) {
    const t0 = bar * DEMO_BAR_SEC;
    const { root } = PROGRESSION[bar % 4];
    note(t0, root, 1.6, 1);
    note(t0 + beat * 2, root, 0.9, 0.85);
    note(t0 + beat * 3.5, root + 7, 0.4, 0.7);
  }
  normalizePeak(out, 0.6);
  return out;
}

// --- other: chord pad + arpeggio -------------------------------------------------------------

function synthOther(): Float32Array[] {
  const out = emptyStereo();
  const beat = DEMO_BEAT_SEC;
  const MAX_PAD_HZ = 3200;

  for (let bar = 0; bar < DEMO_BARS; bar += 1) {
    const t0 = bar * DEMO_BAR_SEC;
    const { pad } = PROGRESSION[bar % 4];
    // Pad: two slightly detuned band-limited saws per chord tone, spread across the stereo field.
    pad.forEach((midi, voiceIndex) => {
      [-1, 1].forEach((side) => {
        const hz = midiToHz(midi) * 2 ** ((side * 7) / 1200);
        const harmonics = Math.max(1, Math.floor(MAX_PAD_HZ / hz));
        const length = DEMO_BAR_SEC + 0.15;
        addVoice(
          out,
          t0,
          length,
          (x) => {
            const attack = Math.min(1, x / 0.22);
            const release = x > DEMO_BAR_SEC ? Math.max(0, 1 - (x - DEMO_BAR_SEC) / 0.15) : 1;
            let sum = 0;
            for (let h = 1; h <= harmonics; h += 1) {
              sum += Math.sin(2 * Math.PI * hz * h * x + voiceIndex) / (h * h ** 0.35);
            }
            return 0.11 * attack * release * sum;
          },
          side * 0.55,
        );
      });
    });
    // Arpeggio: one soft pluck per beat from bar 5 on.
    if (bar >= 4) {
      const shape = [0, 1, 2, 1];
      for (let step = 0; step < 4; step += 1) {
        const midi = pad[shape[step]] + 12;
        const hz = midiToHz(midi);
        addVoice(
          out,
          t0 + step * beat,
          0.5,
          (x) =>
            0.2 *
            Math.exp(-x / 0.14) *
            (Math.sin(2 * Math.PI * hz * x) + 0.4 * Math.sin(4 * Math.PI * hz * x)),
          step % 2 === 0 ? -0.3 : 0.3,
        );
      }
    }
  }
  normalizePeak(out, 0.45);
  return out;
}

// --- vocals ----------------------------------------------------------------------------------

type Vowel = { formants: readonly [number, number, number]; widths: readonly [number, number, number] };
const VOWEL_A: Vowel = { formants: [800, 1200, 2800], widths: [90, 110, 160] };
const VOWEL_O: Vowel = { formants: [450, 800, 2830], widths: [70, 80, 120] };
const FORMANT_GAIN = [1, 0.5, 0.2] as const;

/**
 * The sung line: two notes a bar with rests between, so an echo on this stem
 * is easy to hear. The voice enters at bar 5. Two four-bar variants alternate.
 */
const MELODY: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[64, 69], [65, 69], [67, 72], [67, 71]], // variant 1: E4 A4 | F4 A4 | G4 C5 | G4 B4
  [[72, 69], [69, 72], [71, 67], [67, 62]], // variant 2: C5 A4 | A4 C5 | B4 G4 | G4 D4
];

function synthVocals(): Float32Array[] {
  const out = emptyStereo();
  const rng = mulberry32(2025);
  const beat = DEMO_BEAT_SEC;

  const sing = (t: number, midi: number, lengthBeats: number, vowel: Vowel, pan: number) => {
    const f0 = midiToHz(midi);
    const length = lengthBeats * beat;
    const harmonics = Math.floor(7500 / f0);
    // Formant-shaped amplitude of each harmonic, 1/h source tilt.
    const amps: number[] = [];
    for (let h = 1; h <= harmonics; h += 1) {
      const f = f0 * h;
      let shape = 0;
      for (let k = 0; k < 3; k += 1) {
        const d = (f - vowel.formants[k]) / (vowel.widths[k] / 2);
        shape += FORMANT_GAIN[k] / (1 + d * d);
      }
      amps.push((shape + 0.02) / h);
    }
    // Two detuned copies (±5 cents) for width; vibrato fades in after the onset.
    for (const detune of [-5, 5]) {
      const base = f0 * 2 ** (detune / 1200);
      let phase = 0;
      let breathState = 0;
      addVoice(
        out,
        t,
        length + 0.14,
        (x) => {
          const attack = Math.min(1, x / 0.05);
          const release = x > length ? Math.max(0, 1 - (x - length) / 0.12) : 1;
          const vibratoDepth = Math.min(1, Math.max(0, (x - 0.12) / 0.2)) * 0.35; // semitones
          const hz = base * 2 ** ((vibratoDepth * Math.sin(2 * Math.PI * 5.4 * x)) / 12);
          phase += (2 * Math.PI * hz) / DEMO_SAMPLE_RATE;
          let sum = 0;
          for (let h = 1; h <= harmonics; h += 1) sum += amps[h - 1] * Math.sin(phase * h);
          breathState += 0.2 * ((rng() * 2 - 1) - breathState); // low-passed breath, not hiss
          const breath = breathState * 0.02;
          return 0.5 * attack * release * (sum + breath);
        },
        pan + detune * 0.03,
      );
    }
  };

  for (let bar = 4; bar < DEMO_BARS; bar += 1) {
    const t0 = bar * DEMO_BAR_SEC;
    const variant = Math.floor((bar - 4) / 4) % 2;
    const [first, second] = MELODY[variant][bar % 4];
    sing(t0, first, 1.5, bar % 2 === 0 ? VOWEL_A : VOWEL_O, -0.05);
    sing(t0 + beat * 2, second, 1, bar % 2 === 0 ? VOWEL_O : VOWEL_A, 0.05);
  }
  normalizePeak(out, 0.5);
  return out;
}

/** Synthesize all four stems. Pure and deterministic. */
export function synthesizeDemoStems(): DemoStem[] {
  return [
    { name: "vocals", channels: synthVocals() },
    { name: "drums", channels: synthDrums() },
    { name: "bass", channels: synthBass() },
    { name: "other", channels: synthOther() },
  ];
}
