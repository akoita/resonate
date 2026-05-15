import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

export type AgentEnergyBand = "low" | "medium" | "high";

export interface AgentAudioFeatures {
  schemaVersion: "agent-audio-features/v1";
  source: "metadata_inferred" | "generated_metadata" | "fingerprint_metadata";
  confidence: number;
  derivedAt: string;
  durationSeconds?: number;
  tempoBpm: number;
  energy: number;
  energyBand: AgentEnergyBand;
  tags: string[];
  warnings: string[];
}

export type AgentAudioFeatureResult =
  | { status: "ok"; trackId: string; features: AgentAudioFeatures }
  | { status: "failed"; trackId: string; reason: "track_not_found" | "feature_extraction_failed" };

const GENRE_ENERGY: Record<string, number> = {
  ambient: 0.25,
  classical: 0.35,
  focus: 0.3,
  jazz: 0.45,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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

@Injectable()
export class AgentAudioFeatureService {
  async getOrCreate(trackId: string): Promise<AgentAudioFeatureResult> {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: {
        release: { select: { genre: true } },
        stems: { select: { type: true, durationSeconds: true } },
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
      if (isAgentAudioFeatures(existing)) {
        return { status: "ok", trackId, features: existing };
      }

      const features = this.deriveFeatures({
        title: track.title,
        genre: track.release.genre,
        generationMetadata: track.generationMetadata,
        stemDurations: track.stems.map((stem) => stem.durationSeconds).filter((value): value is number => typeof value === "number"),
        stemTypes: track.stems.map((stem) => stem.type),
        fingerprintDuration: track.fingerprint?.duration,
        fingerprintSource: track.fingerprint?.source,
      });

      const metadata = isRecord(track.generationMetadata) ? track.generationMetadata : {};
      await prisma.track.update({
        where: { id: trackId },
        data: {
          generationMetadata: {
            ...metadata,
            agentAudioFeatures: features as unknown as Prisma.InputJsonObject,
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
    generationMetadata: Prisma.JsonValue | null;
    stemDurations: number[];
    stemTypes: string[];
    fingerprintDuration?: number;
    fingerprintSource?: string;
  }): AgentAudioFeatures {
    const metadata = isRecord(input.generationMetadata) ? input.generationMetadata : {};
    const genre = input.genre?.trim();
    const normalizedGenre = genre?.toLowerCase() ?? "";
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
    const energy = clamp((genreEnergy ?? 0.5) + titleEnergyBoost + titleEnergyDrop);
    const tempoSeed = hashNumber(`${input.title}:${genre ?? ""}`);
    const tempoBpm = Math.round(78 + (tempoSeed % 72));
    const tags = Array.from(new Set([
      ...(genre ? [genre] : []),
      ...input.stemTypes,
      bandForEnergy(energy),
    ].filter(Boolean)));
    const warnings: string[] = [];
    if (!durationSeconds) warnings.push("duration_unavailable");
    if (!input.fingerprintDuration) warnings.push("fingerprint_unavailable");

    const source = input.fingerprintDuration
      ? "fingerprint_metadata"
      : metadata.provider
        ? "generated_metadata"
        : "metadata_inferred";
    const confidence = clamp(
      0.35 +
      (input.fingerprintDuration ? 0.25 : 0) +
      (stemDuration ? 0.15 : 0) +
      (genre ? 0.1 : 0),
    );

    return {
      schemaVersion: "agent-audio-features/v1",
      source,
      confidence,
      derivedAt: new Date().toISOString(),
      ...(durationSeconds ? { durationSeconds } : {}),
      tempoBpm,
      energy,
      energyBand: bandForEnergy(energy),
      tags,
      warnings,
    };
  }
}

function isAgentAudioFeatures(value: unknown): value is AgentAudioFeatures {
  return isRecord(value) && value.schemaVersion === "agent-audio-features/v1";
}
