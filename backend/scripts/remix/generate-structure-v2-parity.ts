/**
 * Regenerates `src/modules/remix/remix-structure-v2.parity.json` (#1908)
 * from the backend build-up math. The fixture pins what BOTH engines must
 * reproduce (the web preview tests read the same file); regenerate only
 * together with a new REMIX_STRUCTURE_BUILDUP_DSP_VERSION.
 *
 *   npx ts-node --transpile-only scripts/remix/generate-structure-v2-parity.ts
 *
 * `parity.measured` is copied from the last run of the ffmpeg-gated test in
 * remix-structure-buildup.spec.ts (REMIX_BUILDUP_PARITY_LOG=1) and is
 * documentation; the test asserts the tolerances.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  BUILDUP_EDGE_GRID_PER_SECOND,
  BUILDUP_END_HZ,
  BUILDUP_FILTER_Q,
  BUILDUP_START_GAIN,
  BUILDUP_START_HZ,
  BUILDUP_SWEEP_STEPS,
  buildUpCutoffHzAt,
  buildUpGainAt,
  buildUpOutputRamps,
  buildUpRamps,
  buildUpSweepSteps,
  MAX_BUILDUP_BLOCKS,
  normalizeRemixStructureInput,
  REMIX_STRUCTURE_BUILDUP_DSP_VERSION,
  REMIX_STRUCTURE_SCHEMA_VERSION,
  structureTimeline,
  type RemixStructureBlock,
} from "../../src/modules/remix/remix-structure";
import { BUILDUP_STAGE_FRAME_SAMPLES } from "../../src/modules/remix/stem-audio-mixer";

const path = join(
  __dirname,
  "../../src/modules/remix/remix-structure-v2.parity.json",
);
const v1 = JSON.parse(
  readFileSync(
    join(__dirname, "../../src/modules/remix/remix-structure-v1.parity.json"),
    "utf8",
  ),
);
let previous: { parity?: unknown } = {};
try {
  previous = JSON.parse(readFileSync(path, "utf8"));
} catch {
  previous = {};
}
const grid = v1.grid;

const timelines: Array<{ name: string; blocks: RemixStructureBlock[] }> = [
  {
    name: "build-up into the drop",
    blocks: [
      { section: 0 },
      { section: 1 },
      { section: 2, buildUp: true },
      { section: 3 },
      { section: 4 },
    ],
  },
  {
    name: "adjacent build-ups + fades",
    blocks: [
      { section: 1, fadeIn: true },
      { section: 2, buildUp: true },
      { section: 2, buildUp: true, fadeOut: true },
      { section: 3 },
    ],
  },
  {
    name: "pickup build-up",
    blocks: [{ section: 0, buildUp: true }, { section: 1 }, { section: 3 }],
  },
];

const sweepRamp = buildUpOutputRamps(
  buildUpRamps(structureTimeline(grid, timelines[0].blocks)),
  1.17,
)[0];

const normalizeInputs: unknown[] = [
  { blocks: [{ section: 2, buildUp: true }] },
  {
    schemaVersion: "remix-structure/v1",
    blocks: [{ section: 2, buildUp: true }, { section: 3 }],
  },
  {
    schemaVersion: "remix-structure/v2",
    blocks: [{ section: 2, buildUp: false }, { section: 3 }],
  },
  {
    blocks: [
      { section: 0 },
      { section: 1 },
      { section: 2, buildUp: true },
      { section: 3 },
      { section: 4 },
    ],
  },
  { blocks: [{ section: 2, buildUp: 1 }] },
  { schemaVersion: "remix-structure/v3", blocks: [{ section: 2 }] },
  {
    blocks: Array.from({ length: MAX_BUILDUP_BLOCKS + 1 }, () => ({
      section: 1,
      buildUp: true,
    })),
  },
];

const fixture = {
  schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
  dspVersion: REMIX_STRUCTURE_BUILDUP_DSP_VERSION,
  note: "Parity fixture for #1908 build-ups: backend (ffmpeg render) and web (WebAudio preview) must reproduce these values within 1e-9. Regenerate with backend/scripts/remix/generate-structure-v2-parity.ts. `parity` holds the measured ffmpeg-vs-WebAudio-model level error (50 ms RMS windows, pink noise) and the tolerances the ffmpeg-gated test asserts.",
  constants: {
    startHz: BUILDUP_START_HZ,
    endHz: BUILDUP_END_HZ,
    startGain: BUILDUP_START_GAIN,
    filterQ: BUILDUP_FILTER_Q,
    sweepSteps: BUILDUP_SWEEP_STEPS,
    edgeGridPerSecond: BUILDUP_EDGE_GRID_PER_SECOND,
    maxBuildUps: MAX_BUILDUP_BLOCKS,
    stageFrameSamples: BUILDUP_STAGE_FRAME_SAMPLES,
  },
  grid,
  timelines: timelines.map(({ name, blocks }) => {
    const segments = structureTimeline(grid, blocks);
    const buildUps = buildUpRamps(segments);
    return {
      name,
      blocks,
      segments,
      buildUps,
      output: [1, 0.8, 1.17].map((speed) => ({
        speed,
        ramps: buildUpOutputRamps(buildUps, speed),
      })),
    };
  }),
  sweep: { ramp: sweepRamp, steps: buildUpSweepSteps(sweepRamp) },
  samples: [-1, 0, 0.25, 0.5, 0.75, 1].map((u) => {
    const atSec =
      sweepRamp.startSec + (sweepRamp.endSec - sweepRamp.startSec) * u;
    return {
      atSec,
      cutoffHz: buildUpCutoffHzAt(sweepRamp, atSec),
      gain: buildUpGainAt(sweepRamp, atSec),
    };
  }),
  normalize: normalizeInputs.map((input) => {
    const result = normalizeRemixStructureInput(input, grid.sections.length);
    return { input, output: "error" in result ? "error" : result.value };
  }),
  parity: previous.parity ?? {
    windowSeconds: 0.05,
    toleranceMaxWindowDb: 0.5,
    toleranceMaxDropWindowDb: 2.0,
    toleranceMeanWindowDb: 0.05,
    measured: [],
  },
};

writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${path}`);
