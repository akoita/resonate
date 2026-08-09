import { Prisma, type AiDisclosureLevel } from "@prisma/client";

export const AI_DISCLOSURE_VERSION = "ddex-ern-4.3.2-resonate-v1";

export const AI_CONTRIBUTION_FACETS = [
  "vocals",
  "instruments",
  "composition_lyrics",
  "production",
  "post_production",
] as const;

export type AiContributionFacet = (typeof AI_CONTRIBUTION_FACETS)[number];
export type AiDisclosureSource =
  | "artist"
  | "resonate_native"
  | "remix_derived"
  | "migration";
export type DdexContainsAi = "None" | "Partly" | "All";
export type PublicAiDisclosureLevel = "undeclared" | "none" | "partly" | "all";

export type AiDisclosureInput = {
  level: PublicAiDisclosureLevel | AiDisclosureLevel;
  facets?: string[];
};

export type AiDisclosureRecord = {
  level: PublicAiDisclosureLevel;
  containsAI: DdexContainsAi | null;
  facets: AiContributionFacet[];
  source?: AiDisclosureSource;
  schemaVersion?: string;
  declaredAt?: string;
  label: string;
};

export class AiDisclosureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiDisclosureValidationError";
  }
}

const LEVELS = new Set<AiDisclosureLevel>([
  "UNDECLARED",
  "NONE",
  "PARTLY",
  "ALL",
]);
const FACETS = new Set<string>(AI_CONTRIBUTION_FACETS);
const SOURCES = new Set<AiDisclosureSource>([
  "artist",
  "resonate_native",
  "remix_derived",
  "migration",
]);

export const AI_PROMOTIONAL_ELIGIBILITY_WHERE = {
  aiDisclosureLevel: { not: "ALL" },
} satisfies Prisma.TrackWhereInput;

export function toDdexContainsAi(
  level: AiDisclosureLevel,
): DdexContainsAi | null {
  switch (level) {
    case "NONE":
      return "None";
    case "PARTLY":
      return "Partly";
    case "ALL":
      return "All";
    case "UNDECLARED":
      return null;
  }
}

export function aiDisclosureLabel(level: AiDisclosureLevel): string {
  switch (level) {
    case "NONE":
      return "No AI involvement declared";
    case "PARTLY":
      return "AI-assisted";
    case "ALL":
      return "Fully AI-generated";
    case "UNDECLARED":
      return "AI disclosure unavailable";
  }
}

export function normalizeAiDisclosureInput(
  value: unknown,
  options?: { allowUndeclared?: boolean },
): { level: AiDisclosureLevel; facets: AiContributionFacet[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiDisclosureValidationError(
      "Each track must include an aiDisclosure declaration.",
    );
  }

  const input = value as { level?: unknown; facets?: unknown };
  const normalizedLevel =
    typeof input.level === "string" ? input.level.trim().toUpperCase() : "";
  if (!LEVELS.has(normalizedLevel as AiDisclosureLevel)) {
    throw new AiDisclosureValidationError(
      "aiDisclosure.level must be none, partly, or all.",
    );
  }
  const level = normalizedLevel as AiDisclosureLevel;
  if (level === "UNDECLARED" && !options?.allowUndeclared) {
    throw new AiDisclosureValidationError(
      "UNDECLARED is reserved for legacy records; new tracks must declare AI involvement.",
    );
  }

  if (input.facets !== undefined && !Array.isArray(input.facets)) {
    throw new AiDisclosureValidationError("aiDisclosure.facets must be an array.");
  }
  const rawFacets = (input.facets ?? []) as unknown[];
  if (rawFacets.some((facet) => typeof facet !== "string")) {
    throw new AiDisclosureValidationError("aiDisclosure.facets must contain only facet codes.");
  }
  const facets = Array.from(
    new Set(rawFacets.map((facet) => (facet as string).trim().toLowerCase()).filter(Boolean)),
  );
  const unsupported = facets.filter((facet) => !FACETS.has(facet));
  if (unsupported.length > 0) {
    throw new AiDisclosureValidationError(
      `Unsupported AI contribution facet: ${unsupported.join(", ")}.`,
    );
  }
  if (level === "NONE" && facets.length > 0) {
    throw new AiDisclosureValidationError(
      "NONE declarations cannot include AI contribution facets.",
    );
  }
  if (level === "PARTLY" && facets.length === 0) {
    throw new AiDisclosureValidationError(
      "PARTLY declarations must include at least one AI contribution facet.",
    );
  }

  return { level, facets: facets as AiContributionFacet[] };
}

export function normalizeAiDisclosureSource(value: unknown): AiDisclosureSource {
  return typeof value === "string" && SOURCES.has(value as AiDisclosureSource)
    ? (value as AiDisclosureSource)
    : "migration";
}

export function toAiDisclosureRecord(track: {
  aiDisclosureLevel: AiDisclosureLevel;
  aiContributionFacets?: string[] | null;
  aiDisclosureSource?: string | null;
  aiDisclosureVersion?: string | null;
  aiDeclaredAt?: Date | string | null;
}): AiDisclosureRecord {
  const contributionFacets = (track.aiContributionFacets ?? []).filter(
    (facet): facet is AiContributionFacet => FACETS.has(facet),
  );
  return {
    level: track.aiDisclosureLevel.toLowerCase() as PublicAiDisclosureLevel,
    containsAI: toDdexContainsAi(track.aiDisclosureLevel),
    facets: contributionFacets,
    source: normalizeAiDisclosureSource(track.aiDisclosureSource),
    ...(track.aiDisclosureVersion
      ? { schemaVersion: track.aiDisclosureVersion }
      : {}),
    ...(track.aiDeclaredAt
      ? { declaredAt: new Date(track.aiDeclaredAt).toISOString() }
      : {}),
    label: aiDisclosureLabel(track.aiDisclosureLevel),
  };
}

export function deriveReleaseAiDisclosureSummary(
  tracks: Array<{
    aiDisclosureLevel: AiDisclosureLevel;
    aiContributionFacets?: string[] | null;
    aiDisclosureSource?: string | null;
    aiDisclosureVersion?: string | null;
    aiDeclaredAt?: Date | string | null;
  }>,
): AiDisclosureRecord {
  const levels = Array.from(new Set(tracks.map((track) => track.aiDisclosureLevel)));
  const hasDeclaredAi = levels.includes("PARTLY") || levels.includes("ALL");
  const aggregateLevel: AiDisclosureLevel =
    levels.length === 0
      ? "UNDECLARED"
      : levels.length === 1
        ? levels[0]
        : hasDeclaredAi
          ? "PARTLY"
          : "UNDECLARED";
  const facets = Array.from(
    new Set(
      tracks.flatMap((track) =>
        (track.aiContributionFacets ?? []).filter((facet) => FACETS.has(facet)),
      ),
    ),
  ) as AiContributionFacet[];
  const sources = Array.from(
    new Set(tracks.map((track) => normalizeAiDisclosureSource(track.aiDisclosureSource))),
  );
  const versions = Array.from(
    new Set(tracks.map((track) => track.aiDisclosureVersion).filter(Boolean)),
  );
  const declaredAt = tracks
    .map((track) => track.aiDeclaredAt && new Date(track.aiDeclaredAt))
    .filter((value): value is Date => !!value && !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return {
    level: aggregateLevel.toLowerCase() as PublicAiDisclosureLevel,
    containsAI: toDdexContainsAi(aggregateLevel),
    facets,
    ...(sources.length === 1 ? { source: sources[0] } : {}),
    ...(versions.length === 1 ? { schemaVersion: versions[0] as string } : {}),
    ...(declaredAt ? { declaredAt: declaredAt.toISOString() } : {}),
    label: aiDisclosureLabel(aggregateLevel),
  };
}

export function isPromotionEligible(level: unknown): boolean {
  return typeof level !== "string" || level.trim().toUpperCase() !== "ALL";
}

export function deriveRemixAiDisclosure(grounding: string): {
  level: Exclude<AiDisclosureLevel, "UNDECLARED">;
  facets: AiContributionFacet[];
} {
  switch (grounding) {
    case "stem_audio":
      return { level: "NONE", facets: [] };
    case "prompt_only":
      return { level: "ALL", facets: [] };
    case "stem_plus_ai":
    case "audio_conditioned":
    case "feature_conditioned":
      return { level: "PARTLY", facets: ["production"] };
    default:
      throw new AiDisclosureValidationError(
        `Cannot derive AI disclosure from grounding mode: ${grounding}.`,
      );
  }
}
