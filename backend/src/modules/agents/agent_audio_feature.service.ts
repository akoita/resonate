import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  EMPTY_MEASURED_TRACK_FEATURES,
  MeasuredTrackFeatures,
  measuredTrackFeatures,
} from "./measured_track_features";

export type AgentEnergyBand = "low" | "medium" | "high";
export type AgentTempoBand = "slow" | "mid" | "fast";
export type AgentDurationBucket = "short" | "standard" | "long" | "unknown";

export interface AgentAudioFeatureVector {
  dimensions: [
    "energy",
    "tempo",
    "duration",
    "stem_density",
    "vocal_presence",
    "beat_presence",
    "generated_likelihood",
  ];
  values: number[];
}

/**
 * Per-field provenance (#1960). `inferred` values are metadata-derived (the
 * tempo is a hash of title+genre, not a measurement) and must not be shown to
 * listeners as a BPM; `measured` values come from the full-mix extractor.
 */
export interface AgentAudioFeatureSources {
  tempo: "measured" | "inferred";
  key: "measured" | "unavailable";
  energy: "measured" | "inferred";
}

export interface AgentAudioFeatures {
  schemaVersion: "agent-audio-features/v2";
  source:
    | "measured_full_mix"
    | "metadata_inferred"
    | "generated_metadata"
    | "fingerprint_metadata";
  extractor: {
    name: "metadata_feature_seed";
    version: "2026-05-15";
  };
  confidence: number;
  derivedAt: string;
  invalidatesAt?: string;
  durationSeconds?: number;
  durationBucket: AgentDurationBucket;
  tempoBpm: number;
  /** Extractor tempo confidence; present only when the tempo is measured. */
  tempoConfidence?: number;
  tempoBand: AgentTempoBand;
  key: { tonic: string; mode: "major" | "minor"; confidence: number } | null;
  camelot: string | null;
  featureSources: AgentAudioFeatureSources;
  energy: number;
  energyBand: AgentEnergyBand;
  normalizedGenre?: string;
  descriptors: {
    genres: string[];
    moods: string[];
    instrumentation: string[];
    texture: string[];
  };
  featureVector: AgentAudioFeatureVector;
  tags: string[];
  warnings: string[];
}

export type AgentAudioFeatureResult =
  | { status: "ok"; trackId: string; features: AgentAudioFeatures }
  | { status: "failed"; trackId: string; reason: "track_not_found" | "feature_extraction_failed" };

const GENRE_ENERGY: Record<string, number> = {
  alternative: 0.58,
  ambient: 0.25,
  anime: 0.72,
  classical: 0.35,
  drill: 0.8,
  electronic: 0.78,
  focus: 0.3,
  jazz: 0.45,
  "j-pop": 0.68,
  "lo-fi": 0.35,
  lofi: 0.35,
  pop: 0.65,
  "r&b": 0.48,
  rap: 0.7,
  reggaeton: 0.78,
  rock: 0.74,
  techno: 0.85,
  trap: 0.78,
};

const BEAT_STEMS = new Set(["drums", "percussion"]);
const HARMONIC_STEMS = new Set(["bass", "guitar", "piano", "keys", "synth"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Confidence floor when only the energy composite is measured (tempo unreliable). */
const MEASURED_ENERGY_ONLY_CONFIDENCE = 0.5;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function hashNumber(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function bandForEnergy(energy: number): AgentEnergyBand {
  if (energy >= 0.67) return "high";
  if (energy >= 0.38) return "medium";
  return "low";
}

function bandForTempo(tempoBpm: number): AgentTempoBand {
  if (tempoBpm >= 124) return "fast";
  if (tempoBpm >= 96) return "mid";
  return "slow";
}

function bucketForDuration(durationSeconds?: number): AgentDurationBucket {
  if (!durationSeconds) return "unknown";
  if (durationSeconds < 90) return "short";
  if (durationSeconds <= 330) return "standard";
  return "long";
}

function normalizeString(value: string) {
  return value.trim().toLowerCase();
}

function normalizeFeatureValue(value: number) {
  return Number(clamp(value).toFixed(4));
}

@Injectable()
export class AgentAudioFeatureService {
  async getOrCreate(trackId: string): Promise<AgentAudioFeatureResult> {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: {
        release: { select: { genre: true, title: true, primaryArtist: true } },
        stems: {
          where: { isCurrent: true },
          select: { id: true, type: true, durationSeconds: true, audioFeatures: true },
        },
        fingerprint: { select: { duration: true, source: true } },
      },
    });

    if (!track) {
      return { status: "failed", trackId, reason: "track_not_found" };
    }

    try {
      const existing = isRecord(track.generationMetadata)
        ? track.generationMetadata.agentAudioFeatures
        : undefined;
      const cachedRevision = isRecord(track.generationMetadata)
        ? track.generationMetadata.agentAudioRevision
        : null;
      const cachedMeasuredKey = isRecord(track.generationMetadata)
        ? track.generationMetadata.agentAudioMeasuredKey
        : null;
      const originalStem = track.stems.find((stem) => stem.type === "original");
      const measured = measuredTrackFeatures(originalStem?.audioFeatures);
      const measuredKey = measuredCacheKey(originalStem?.id, measured);
      if (
        isAgentAudioFeatures(existing) &&
        (cachedRevision ?? null) === (track.activeAudioRevision ?? null) &&
        cachedMeasuredKey === measuredKey
      ) {
        return { status: "ok", trackId, features: existing };
      }

      const features = this.deriveFeatures({
        title: track.title,
        genre: track.release.genre,
        releaseTitle: track.release.title,
        primaryArtist: track.release.primaryArtist,
        generationMetadata: track.generationMetadata,
        stemDurations: track.stems.map((stem) => stem.durationSeconds).filter((value): value is number => typeof value === "number"),
        stemTypes: track.stems.map((stem) => stem.type),
        fingerprintDuration: track.fingerprint?.duration,
        fingerprintSource: track.fingerprint?.source,
        measured,
      });

      const metadata = isRecord(track.generationMetadata) ? track.generationMetadata : {};
      await prisma.track.update({
        where: { id: trackId },
        data: {
          generationMetadata: {
            ...metadata,
            agentAudioFeatures: features as unknown as Prisma.InputJsonObject,
            agentAudioRevision: track.activeAudioRevision,
            agentAudioMeasuredKey: measuredKey,
          } as unknown as Prisma.InputJsonObject,
        },
      });

      return { status: "ok", trackId, features };
    } catch {
      return { status: "failed", trackId, reason: "feature_extraction_failed" };
    }
  }

  private deriveFeatures(input: {
    title: string;
    genre?: string | null;
    releaseTitle?: string | null;
    primaryArtist?: string | null;
    generationMetadata: Prisma.JsonValue | null;
    stemDurations: number[];
    stemTypes: string[];
    fingerprintDuration?: number;
    fingerprintSource?: string;
    measured?: MeasuredTrackFeatures;
  }): AgentAudioFeatures {
    const measured = input.measured ?? EMPTY_MEASURED_TRACK_FEATURES;
    const metadata = isRecord(input.generationMetadata) ? input.generationMetadata : {};
    const genre = input.genre?.trim();
    const normalizedGenre = genre?.toLowerCase() ?? "";
    const stemTypes = input.stemTypes.map(normalizeString).filter(Boolean);
    const metadataDuration = typeof metadata.durationSeconds === "number"
      ? metadata.durationSeconds
      : undefined;
    const stemDuration = input.stemDurations.length
      ? Math.max(...input.stemDurations)
      : undefined;
    const durationSeconds = input.fingerprintDuration ?? stemDuration ?? metadataDuration;
    const genreEnergy = genre
      ? Object.entries(GENRE_ENERGY).find(([key]) => normalizedGenre.includes(key))?.[1]
      : undefined;
    const titleEnergyBoost = /\b(club|dance|drill|heavy|kick|rave|trap|upbeat)\b/i.test(input.title) ? 0.12 : 0;
    const titleEnergyDrop = /\b(ambient|calm|dream|focus|soft|sleep)\b/i.test(input.title) ? -0.1 : 0;
    const inferredEnergy = clamp((genreEnergy ?? 0.5) + titleEnergyBoost + titleEnergyDrop);
    const energyMeasured = measured.energy !== null;
    const energy = measured.energy ?? inferredEnergy;
    const tempoSeed = hashNumber(`${input.title}:${genre ?? ""}`);
    const tempoMeasured = measured.tempoBpm !== null;
    const tempoBpm = measured.tempoBpm ?? Math.round(78 + (tempoSeed % 72));
    const durationBucket = bucketForDuration(durationSeconds);
    const tempoBand = bandForTempo(tempoBpm);
    const instrumentation = Array.from(new Set(stemTypes));
    const vocalPresence = stemTypes.includes("vocals") ? 1 : 0;
    const beatPresence = stemTypes.some((type) => BEAT_STEMS.has(type)) ? 1 : 0;
    const harmonicPresence = stemTypes.some((type) => HARMONIC_STEMS.has(type));
    const generatedLikelihood = metadata.provider || metadata.generatedAt || metadata.prompt ? 1 : 0;
    const moods = Array.from(new Set([
      bandForEnergy(energy),
      tempoBand,
      ...(titleEnergyDrop < 0 ? ["calm"] : []),
      ...(titleEnergyBoost > 0 ? ["high_motion"] : []),
    ]));
    const texture = Array.from(new Set([
      ...(beatPresence ? ["percussive"] : []),
      ...(vocalPresence ? ["vocal"] : ["instrumental"]),
      ...(harmonicPresence ? ["harmonic"] : []),
      ...(generatedLikelihood ? ["ai_generated"] : []),
    ]));
    const durationNormalized = durationSeconds
      ? clamp(durationSeconds / 360)
      : 0;
    const stemDensity = clamp(stemTypes.length / 6);
    const featureVector: AgentAudioFeatureVector = {
      dimensions: [
        "energy",
        "tempo",
        "duration",
        "stem_density",
        "vocal_presence",
        "beat_presence",
        "generated_likelihood",
      ],
      values: [
        normalizeFeatureValue(energy),
        normalizeFeatureValue((tempoBpm - 60) / 120),
        normalizeFeatureValue(durationNormalized),
        normalizeFeatureValue(stemDensity),
        normalizeFeatureValue(vocalPresence),
        normalizeFeatureValue(beatPresence),
        normalizeFeatureValue(generatedLikelihood),
      ],
    };
    const tags = Array.from(new Set([
      ...(genre ? [genre] : []),
      ...stemTypes,
      bandForEnergy(energy),
      tempoBand,
      durationBucket,
      ...texture,
    ].filter(Boolean)));
    const warnings: string[] = [];
    if (!durationSeconds) warnings.push("duration_unavailable");
    if (!input.fingerprintDuration) warnings.push("fingerprint_unavailable");
    if (!genre) warnings.push("genre_unavailable");
    if (stemTypes.length === 0) warnings.push("stems_unavailable");

    const inferredSource = input.fingerprintDuration
      ? "fingerprint_metadata"
      : metadata.provider
        ? "generated_metadata"
        : "metadata_inferred";
    const source: AgentAudioFeatures["source"] = tempoMeasured || energyMeasured
      ? "measured_full_mix"
      : inferredSource;
    const inferredConfidence = clamp(
      0.35 +
      (input.fingerprintDuration ? 0.25 : 0) +
      (stemDuration ? 0.15 : 0) +
      (genre ? 0.1 : 0),
    );
    const confidence = tempoMeasured
      ? Math.max(inferredConfidence, measured.tempoConfidence ?? 0)
      : energyMeasured
        ? Math.max(inferredConfidence, MEASURED_ENERGY_ONLY_CONFIDENCE)
        : inferredConfidence;

    return {
      schemaVersion: "agent-audio-features/v2",
      source,
      extractor: {
        name: "metadata_feature_seed",
        version: "2026-05-15",
      },
      confidence,
      derivedAt: new Date().toISOString(),
      ...(durationSeconds ? { durationSeconds } : {}),
      durationBucket,
      tempoBpm,
      ...(tempoMeasured && measured.tempoConfidence !== null
        ? { tempoConfidence: measured.tempoConfidence }
        : {}),
      tempoBand,
      key: measured.key,
      camelot: measured.camelot,
      featureSources: {
        tempo: tempoMeasured ? "measured" : "inferred",
        key: measured.key ? "measured" : "unavailable",
        energy: energyMeasured ? "measured" : "inferred",
      },
      energy,
      energyBand: bandForEnergy(energy),
      ...(normalizedGenre ? { normalizedGenre } : {}),
      descriptors: {
        genres: genre ? [genre] : [],
        moods,
        instrumentation,
        texture,
      },
      featureVector,
      tags,
      warnings,
    };
  }
}

function isAgentAudioFeatures(value: unknown): value is AgentAudioFeatures {
  // Entries cached before #1960 have no featureSources and are stale.
  return (
    isRecord(value) &&
    value.schemaVersion === "agent-audio-features/v2" &&
    isRecord(value.featureSources)
  );
}

/**
 * Short stable key over the original stem id and its measured fields. A
 * backfill or re-ingestion that changes them changes the key, so the cached
 * derivation is refreshed on next read. "none" when nothing is measured.
 */
function measuredCacheKey(stemId: string | undefined, measured: MeasuredTrackFeatures) {
  if (!stemId) return "none";
  if (measured.tempoBpm === null && measured.key === null && measured.energy === null) {
    return "none";
  }
  return createHash("sha1")
    .update(JSON.stringify({ stemId, measured }))
    .digest("hex")
    .slice(0, 16);
}
