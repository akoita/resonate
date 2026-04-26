import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { keccak256, stringToHex } from "viem";

export const STEM_QUALITY_TASK_TYPE = "stem.quality_rating";
export const STEM_QUALITY_SCHEMA_VERSION = "resonate-stem-quality-rating/v1";
export const DEFAULT_MIN_STEM_QUALITY_SCORE = 20;

export type StemQualityMetricName =
  | "rmsEnergy"
  | "spectralDensity"
  | "silenceRatio"
  | "musicalSalience";

export type StemQualityAnalysis = {
  schemaVersion: typeof STEM_QUALITY_SCHEMA_VERSION;
  taskType: typeof STEM_QUALITY_TASK_TYPE;
  stemId: string;
  tokenId: string | null;
  stemType: string;
  score: number;
  metrics: Record<StemQualityMetricName, number>;
  confidence: number;
  analysisMethod: "pcm-wav-v1" | "byte-envelope-v1";
  sampleCount: number;
  byteLength: number;
  checksum: string;
  analyzedAt: string;
};

export type StemQualityRatingPayload = StemQualityAnalysis & {
  curator: {
    userId: string;
    agentConfigId: string | null;
    identityRegistry: string | null;
    identityTokenId: string | null;
  };
  erc8004: {
    taskType: typeof STEM_QUALITY_TASK_TYPE;
    input: { stemId: string; tokenId: string | null };
    output: { score: number; analysisUri: string };
  };
};

export type QualityRankedListing<T extends { stemType: string; tokenId: bigint }> = T & {
  qualityScore: number | null;
  qualityConfidence: number | null;
  qualityRatingId: string | null;
  qualityWeightedRank: number;
};

export type QualityRatingSummary = {
  id: string;
  tokenId: bigint;
  score: number;
  confidence: number;
  purchaseValidationCount?: number;
  skipValidationCount?: number;
  reputationDelta?: number;
};

const STEM_TYPE_PRIORITY: Record<string, number> = {
  vocals: 1,
  vocal: 1,
  drums: 0.9,
  drum: 0.9,
  bass: 0.85,
  guitar: 0.75,
  piano: 0.72,
  keys: 0.72,
  strings: 0.68,
  synth: 0.65,
  other: 0.45,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function readAscii(buffer: Buffer, offset: number, length: number): string {
  if (offset + length > buffer.length) return "";
  return buffer.toString("ascii", offset, offset + length);
}

function decodePcmWav(buffer: Buffer): number[] | null {
  if (readAscii(buffer, 0, 4) !== "RIFF" || readAscii(buffer, 8, 4) !== "WAVE") {
    return null;
  }

  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let cursor = 12;

  while (cursor + 8 <= buffer.length) {
    const chunkId = readAscii(buffer, cursor, 4);
    const chunkSize = buffer.readUInt32LE(cursor + 4);
    const contentOffset = cursor + 8;
    if (chunkId === "fmt ") {
      fmtOffset = contentOffset;
      fmtSize = chunkSize;
    } else if (chunkId === "data") {
      dataOffset = contentOffset;
      dataSize = chunkSize;
    }
    cursor = contentOffset + chunkSize + (chunkSize % 2);
  }

  if (fmtOffset < 0 || fmtSize < 16 || dataOffset < 0 || dataSize <= 0) {
    return null;
  }

  const audioFormat = buffer.readUInt16LE(fmtOffset);
  const channels = Math.max(1, buffer.readUInt16LE(fmtOffset + 2));
  const bitsPerSample = buffer.readUInt16LE(fmtOffset + 14);
  if (audioFormat !== 1 || ![8, 16, 24, 32].includes(bitsPerSample)) {
    return null;
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(Math.min(dataSize, buffer.length - dataOffset) / frameSize);
  const maxSamples = 200_000;
  const step = Math.max(1, Math.ceil(frameCount / maxSamples));
  const samples: number[] = [];

  for (let frame = 0; frame < frameCount; frame += step) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataOffset + frame * frameSize + channel * bytesPerSample;
      if (bitsPerSample === 8) {
        sum += (buffer.readUInt8(offset) - 128) / 128;
      } else if (bitsPerSample === 16) {
        sum += buffer.readInt16LE(offset) / 32768;
      } else if (bitsPerSample === 24) {
        sum += buffer.readIntLE(offset, 3) / 8388608;
      } else {
        sum += buffer.readInt32LE(offset) / 2147483648;
      }
    }
    samples.push(sum / channels);
  }

  return samples.length > 0 ? samples : null;
}

function buildByteEnvelope(buffer: Buffer): number[] {
  if (buffer.length === 0) return [];
  const maxSamples = 200_000;
  const step = Math.max(1, Math.ceil(buffer.length / maxSamples));
  const samples: number[] = [];
  for (let index = 0; index < buffer.length; index += step) {
    samples.push((buffer[index] - 128) / 128);
  }
  return samples;
}

function computeMetrics(samples: number[], stemType: string) {
  if (samples.length === 0) {
    return {
      rmsEnergy: 0,
      spectralDensity: 0,
      silenceRatio: 1,
      musicalSalience: 0,
      confidence: 0,
    };
  }

  let squareSum = 0;
  let deltaSum = 0;
  let previous = samples[0];
  for (const sample of samples) {
    squareSum += sample * sample;
    deltaSum += Math.abs(sample - previous);
    previous = sample;
  }

  const rmsEnergy = clamp01(Math.sqrt(squareSum / samples.length) * 2.5);
  const spectralDensity = clamp01((deltaSum / Math.max(1, samples.length - 1)) * 3);

  const windowSize = 1024;
  let silentWindows = 0;
  let windows = 0;
  for (let index = 0; index < samples.length; index += windowSize) {
    const window = samples.slice(index, index + windowSize);
    const windowRms = Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
    if (windowRms < 0.015) silentWindows += 1;
    windows += 1;
  }
  const silenceRatio = windows === 0 ? 1 : clamp01(silentWindows / windows);
  const stemPriority = STEM_TYPE_PRIORITY[stemType.toLowerCase()] ?? STEM_TYPE_PRIORITY.other;
  const musicalSalience = clamp01((rmsEnergy * 0.45) + (spectralDensity * 0.25) + ((1 - silenceRatio) * 0.2) + (stemPriority * 0.1));
  const confidence = clamp01(0.35 + Math.min(samples.length, 50_000) / 100_000 + (1 - silenceRatio) * 0.25);

  return {
    rmsEnergy: roundMetric(rmsEnergy),
    spectralDensity: roundMetric(spectralDensity),
    silenceRatio: roundMetric(silenceRatio),
    musicalSalience: roundMetric(musicalSalience),
    confidence: roundMetric(confidence),
  };
}

export function analyzeStemQuality(input: {
  stemId: string;
  tokenId?: bigint | string | null;
  stemType: string;
  audio: Buffer;
  analyzedAt?: Date;
}): StemQualityAnalysis {
  const pcmSamples = decodePcmWav(input.audio);
  const samples = pcmSamples ?? buildByteEnvelope(input.audio);
  const metrics = computeMetrics(samples, input.stemType);
  const score = Math.round(
    (
      metrics.rmsEnergy * 0.3 +
      metrics.spectralDensity * 0.2 +
      (1 - metrics.silenceRatio) * 0.25 +
      metrics.musicalSalience * 0.25
    ) * 100,
  );

  return {
    schemaVersion: STEM_QUALITY_SCHEMA_VERSION,
    taskType: STEM_QUALITY_TASK_TYPE,
    stemId: input.stemId,
    tokenId: input.tokenId == null ? null : String(input.tokenId),
    stemType: input.stemType,
    score: Math.max(0, Math.min(100, score)),
    metrics: {
      rmsEnergy: metrics.rmsEnergy,
      spectralDensity: metrics.spectralDensity,
      silenceRatio: metrics.silenceRatio,
      musicalSalience: metrics.musicalSalience,
    },
    confidence: metrics.confidence,
    analysisMethod: pcmSamples ? "pcm-wav-v1" : "byte-envelope-v1",
    sampleCount: samples.length,
    byteLength: input.audio.length,
    checksum: createHash("sha256").update(input.audio).digest("hex"),
    analyzedAt: (input.analyzedAt ?? new Date()).toISOString(),
  };
}

export function buildStemQualityRatingPayload(input: {
  analysis: StemQualityAnalysis;
  curatorUserId: string;
  curatorAgentConfigId?: string | null;
  curatorIdentityRegistry?: string | null;
  curatorIdentityTokenId?: string | null;
  analysisUri: string;
}): StemQualityRatingPayload {
  return {
    ...input.analysis,
    curator: {
      userId: input.curatorUserId,
      agentConfigId: input.curatorAgentConfigId ?? null,
      identityRegistry: input.curatorIdentityRegistry ?? null,
      identityTokenId: input.curatorIdentityTokenId ?? null,
    },
    erc8004: {
      taskType: STEM_QUALITY_TASK_TYPE,
      input: {
        stemId: input.analysis.stemId,
        tokenId: input.analysis.tokenId,
      },
      output: {
        score: input.analysis.score,
        analysisUri: input.analysisUri,
      },
    },
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function computeStemQualityTaskHash(payload: StemQualityRatingPayload): string {
  return keccak256(stringToHex(stableStringify(payload)));
}

export function buildStemQualityMetadataKey(taskHash: string): string {
  return `resonate.task.${STEM_QUALITY_TASK_TYPE}.${taskHash.replace(/^0x/, "")}`;
}

export function scoreWeightedListingRank(input: {
  stemType: string;
  qualityScore: number | null;
  confidence?: number | null;
}): number {
  const typePriority = STEM_TYPE_PRIORITY[input.stemType.toLowerCase()] ?? STEM_TYPE_PRIORITY.other;
  const quality = input.qualityScore == null ? 0.5 : input.qualityScore / 100;
  const confidence = input.confidence == null ? 0.25 : input.confidence;
  return Number(((quality * 0.75 + confidence * 0.1 + typePriority * 0.15) * 100).toFixed(3));
}

export function rankListingsByQuality<T extends { stemType: string; tokenId: bigint }>(
  listings: T[],
  ratings: QualityRatingSummary[],
  options: { minScore?: number } = {},
): Array<QualityRankedListing<T>> {
  const minScore = options.minScore ?? DEFAULT_MIN_STEM_QUALITY_SCORE;
  const latestByToken = new Map<string, QualityRatingSummary>();
  for (const rating of ratings) {
    const key = rating.tokenId.toString();
    const previous = latestByToken.get(key);
    if (!previous || rating.score > previous.score) {
      latestByToken.set(key, rating);
    }
  }

  return listings
    .map((listing) => {
      const rating = latestByToken.get(listing.tokenId.toString());
      return {
        ...listing,
        qualityScore: rating?.score ?? null,
        qualityConfidence: rating?.confidence ?? null,
        qualityRatingId: rating?.id ?? null,
        qualityWeightedRank: scoreWeightedListingRank({
          stemType: listing.stemType,
          qualityScore: rating?.score ?? null,
          confidence: rating?.confidence ?? null,
        }),
      };
    })
    .filter((listing) => listing.qualityScore == null || listing.qualityScore >= minScore)
    .sort((a, b) =>
      b.qualityWeightedRank - a.qualityWeightedRank ||
      (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0),
    );
}

export function computeCuratorReputationDelta(input: {
  score: number;
  validation: "purchase" | "skip";
}): number {
  if (input.validation === "purchase") {
    return input.score >= 70 ? 2 : input.score >= 40 ? 1 : -1;
  }
  return input.score < DEFAULT_MIN_STEM_QUALITY_SCORE ? 1 : -1;
}
