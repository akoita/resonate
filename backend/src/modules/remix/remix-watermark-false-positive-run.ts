import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  inverseSearchShifts,
  REMIX_WATERMARK_DETECT_STAGES,
  type RemixWatermarkCandidate,
  type RemixWatermarkDetectStage,
  type RemixWatermarkShift,
} from "./remix-watermark-detect";

/**
 * False-positive run for the remix watermark detector (#2614 item 2,
 * docs/rfc/remix-watermarking.md "False positives"). Runs the same stages as
 * the admin check over a list of audio that was never marked and reports any
 * decoded payload that equals a stored token. The decoder prints candidates
 * on unmarked audio too, so the figure that matters is how many of them equal
 * a stored token: the RFC expects none.
 *
 * The run reads audio and the token table; it writes nothing to the database.
 */
export type FalsePositiveRunDepth = "plain" | "speed" | "full";

export type FalsePositiveRunEntry = {
  /** Shown in the report: a track id, a stem id or a file name. */
  label: string;
  load: () => Promise<Buffer | null>;
};

export type FalsePositiveRunDetector = {
  decodeClip(inputPath: string, outputPath: string): Promise<void>;
  candidates(
    wavPath: string,
    stage: RemixWatermarkDetectStage,
  ): Promise<RemixWatermarkCandidate[]>;
  inverseCandidates(
    wavPath: string,
    shift: RemixWatermarkShift,
  ): Promise<RemixWatermarkCandidate[]>;
};

/** Given decoded payloads, returns the stored (token, keyId) pairs among them. */
export type FalsePositiveTokenLookup = (
  payloads: string[],
) => Promise<Array<{ token: string; keyId: string }>>;

export type FalsePositiveHit = {
  label: string;
  stage: RemixWatermarkDetectStage;
  keyId: string;
  shift?: RemixWatermarkShift;
};

export type FalsePositiveRunReport = {
  depth: FalsePositiveRunDepth;
  listed: number;
  checked: number;
  skipped: Array<{ label: string; reason: "missing" | "decode_failed" | "detector_failed" }>;
  /** Distinct payloads the decoder printed, per stage. Never the payloads. */
  candidatesDecoded: Record<RemixWatermarkDetectStage, number>;
  /** Clips where a decoded payload equalled a stored token of the same key. */
  hits: FalsePositiveHit[];
};

export type FalsePositiveRunOptions = {
  entries: FalsePositiveRunEntry[];
  detector: FalsePositiveRunDetector;
  lookup: FalsePositiveTokenLookup;
  depth?: FalsePositiveRunDepth;
  onProgress?: (done: number, total: number, label: string) => void;
};

async function storedMatch(
  candidates: RemixWatermarkCandidate[],
  lookup: FalsePositiveTokenLookup,
): Promise<RemixWatermarkCandidate | null> {
  if (candidates.length === 0) return null;
  const rows = await lookup([...new Set(candidates.map((candidate) => candidate.payload))]);
  return (
    candidates.find((candidate) =>
      rows.some((row) => row.token === candidate.payload && row.keyId === candidate.keyId),
    ) ?? null
  );
}

export async function runRemixWatermarkFalsePositiveCheck(
  options: FalsePositiveRunOptions,
): Promise<FalsePositiveRunReport> {
  const depth = options.depth ?? "speed";
  const report: FalsePositiveRunReport = {
    depth,
    listed: options.entries.length,
    checked: 0,
    skipped: [],
    candidatesDecoded: { plain: 0, speed: 0, inverse: 0 },
    hits: [],
  };
  const stages = REMIX_WATERMARK_DETECT_STAGES.filter(
    (stage) => stage === "plain" || depth !== "plain",
  );
  let done = 0;
  for (const entry of options.entries) {
    done += 1;
    options.onProgress?.(done, options.entries.length, entry.label);
    // A list entry the storage provider rejects or cannot find is skipped,
    // not fatal: the run goes on and the report names it.
    const audio = await entry.load().catch(() => null);
    if (!audio || audio.length === 0) {
      report.skipped.push({ label: entry.label, reason: "missing" });
      continue;
    }
    const dir = await mkdtemp(join(tmpdir(), "remix-wmfp-"));
    try {
      const clipPath = join(dir, "clip");
      const wavPath = join(dir, "clip.wav");
      await writeFile(clipPath, audio, { mode: 0o600 });
      try {
        await options.detector.decodeClip(clipPath, wavPath);
      } catch {
        report.skipped.push({ label: entry.label, reason: "decode_failed" });
        continue;
      }
      try {
        let hit: FalsePositiveHit | null = null;
        for (const stage of stages) {
          const candidates = await options.detector.candidates(wavPath, stage);
          report.candidatesDecoded[stage] += new Set(candidates.map((c) => c.payload)).size;
          const match = await storedMatch(candidates, options.lookup);
          if (match) {
            hit = { label: entry.label, stage, keyId: match.keyId };
            break;
          }
        }
        if (!hit && depth === "full") {
          for (const shift of inverseSearchShifts()) {
            const candidates = await options.detector.inverseCandidates(wavPath, shift);
            report.candidatesDecoded.inverse += new Set(candidates.map((c) => c.payload)).size;
            const match = await storedMatch(candidates, options.lookup);
            if (match) {
              hit = { label: entry.label, stage: "inverse", keyId: match.keyId, shift };
              break;
            }
          }
        }
        report.checked += 1;
        if (hit) report.hits.push(hit);
      } catch {
        report.skipped.push({ label: entry.label, reason: "detector_failed" });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return report;
}
