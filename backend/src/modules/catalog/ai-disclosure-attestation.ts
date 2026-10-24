import { Prisma, type PrismaClient } from "@prisma/client";
import type { CatalogAiDisclosureRecordedEvent } from "../../events/event_types";
import { storedArtistIdSignal } from "../artist/artist-external-ids";
import {
  AI_DISCLOSURE_VERSION,
  CATALOG_ATTESTATION_SOURCE,
} from "./ai-disclosure.policy";

/**
 * #2252 - one-off catalog attestation of publicly known human-made releases.
 *
 * AI disclosure (#1336) shipped after most of the catalog was uploaded, so
 * those tracks are `UNDECLARED` with source `"migration"`. For releases whose
 * human origin is publicly established, an operator-reviewed batch records them
 * as `NONE` with the distinct source `catalog_attestation`: a platform
 * attestation, never an artist self-declaration. Everything Resonate cannot
 * establish from public knowledge stays `UNDECLARED`.
 *
 * This module holds the pure classification and the apply logic. The CLI
 * entry points in `src/scripts/` are thin wrappers around it.
 *
 * Signals only PROPOSE. A person reviews the report and decides which release
 * ids go into the manifest; the apply step re-checks every guard itself and
 * never trusts the manifest alone.
 */

/**
 * First instant of the generative-music-AI era for the purposes of this batch.
 * A release (or ISRC reference year) strictly before this is a strong signal
 * that the recording was made without generative music AI. Changing it
 * changes which releases are proposed, so it is a reviewed constant, not an
 * environment variable.
 */
export const GENERATIVE_AI_ERA_CUTOFF = new Date("2023-01-01T00:00:00.000Z");

/** Bump when the classification rules below change; echoed in the report. */
export const ATTESTATION_RULES_VERSION = "2258-v1";

export const ATTESTATION_BUCKETS = ["proposed", "needs_review", "excluded"] as const;
export type AttestationBucket = (typeof ATTESTATION_BUCKETS)[number];

export type AttestationSignalCode =
  | "release_date_before_cutoff"
  | "release_date_on_or_after_cutoff"
  | "isrc_year_before_cutoff"
  | "isrc_year_on_or_after_cutoff"
  | "known_label"
  | "artist_external_id"
  | "artist_external_reference";

export type AttestationSignal = {
  code: AttestationSignalCode;
  /** `supporting` signals can propose; `conflicting` ones force review. */
  kind: "supporting" | "conflicting";
  detail: string;
};

export type AttestationReasonCode =
  | "ai_generated_release"
  | "remix_release"
  | "has_generation_metadata"
  | "no_supporting_signal"
  | "no_undeclared_migration_tracks"
  | "mixed_declarations"
  | "conflicting_signals"
  | "missing_date_evidence"
  | "missing_provenance_evidence";

/**
 * Labels that say "nobody", not "a known label". A release carrying one of
 * these gets no `known_label` signal. Compared case-insensitively after
 * trimming and replacing punctuation with spaces.
 */
export const SELF_RELEASE_LABEL_TOKENS: ReadonlySet<string> = new Set([
  "self released",
  "selfreleased",
  "self release",
  "self published",
  "independent",
  "indie",
  "unsigned",
  "unknown",
  "none",
  "n a",
  "na",
  "no label",
  "resonate",
  "ai generated",
  "test",
]);

/**
 * Hosts that enrichment (`artist-enrichment.service.ts`) draws on. Since #2258
 * enrichment persists the matched MusicBrainz and Wikidata ids on the `Artist`
 * row and the report prefers them (`artist_external_id`). This host inference
 * is only the fallback for artists enrichment has not resolved: the traces are
 * URLs on these hosts (for example the Wikimedia Commons image it suggests).
 */
export const ARTIST_REFERENCE_HOSTS: readonly string[] = [
  "musicbrainz.org",
  "wikidata.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
];

export type AttestationCandidateTrack = {
  id: string;
  isrc: string | null;
  aiDisclosureLevel: string;
  aiDisclosureSource: string;
  hasGenerationMetadata: boolean;
};

export type AttestationCandidateRelease = {
  id: string;
  title: string;
  type: string;
  primaryArtist: string | null;
  label: string | null;
  releaseDate: Date | null;
  artist: {
    id: string;
    displayName: string;
    imageUrl: string | null;
    website: string | null;
    socialLinks: unknown;
    /** #2258 stored enrichment ids; absent/null until enrichment resolves. */
    musicbrainzArtistId?: string | null;
    wikidataQid?: string | null;
    externalIdMatchConfidence?: string | null;
    externalIdMatchedAt?: Date | null;
  } | null;
  tracks: AttestationCandidateTrack[];
};

export type AttestationClassification = {
  releaseId: string;
  title: string;
  primaryArtist: string | null;
  artistId: string | null;
  artistName: string | null;
  label: string | null;
  releaseDate: string | null;
  releaseType: string;
  trackCount: number;
  undeclaredTrackCount: number;
  bucket: AttestationBucket;
  reasons: AttestationReasonCode[];
  signals: AttestationSignal[];
};

/**
 * Four-digit year encoded in an ISRC, or null when the code is malformed.
 *
 * An ISRC is `CC-XXX-YY-NNNNN`; `YY` is the year of reference (two digits).
 * Two-digit years above the current year's last two digits are read as
 * 19YY, the rest as 20YY. The ISRC date comes from the rights holder who
 * minted the code, so it supports "this recording existed then" but is no
 * proof of who uploaded it here.
 */
export function isrcReferenceYear(
  isrc: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!isrc) return null;
  const normalized = isrc.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized)) return null;
  const yy = Number.parseInt(normalized.slice(5, 7), 10);
  const currentYy = now.getUTCFullYear() % 100;
  return yy > currentYy ? 1900 + yy : 2000 + yy;
}

export function isKnownLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const normalized = label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return normalized.length > 1 && !SELF_RELEASE_LABEL_TOKENS.has(normalized);
}

function urlHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string): boolean {
  return ARTIST_REFERENCE_HOSTS.some(
    (reference) => host === reference || host.endsWith(`.${reference}`),
  );
}

/** Hosts from `ARTIST_REFERENCE_HOSTS` that the artist profile points at. */
export function artistReferenceHosts(
  artist: AttestationCandidateRelease["artist"],
): string[] {
  if (!artist) return [];
  const urls: unknown[] = [artist.imageUrl, artist.website];
  if (
    artist.socialLinks &&
    typeof artist.socialLinks === "object" &&
    !Array.isArray(artist.socialLinks)
  ) {
    urls.push(...Object.values(artist.socialLinks as Record<string, unknown>));
  }
  const hosts = urls
    .map(urlHost)
    .filter((host): host is string => host !== null && hostMatches(host));
  return Array.from(new Set(hosts)).sort();
}

function isUndeclaredMigration(track: AttestationCandidateTrack): boolean {
  return (
    track.aiDisclosureLevel === "UNDECLARED" &&
    track.aiDisclosureSource === "migration"
  );
}

/**
 * Place one release in exactly one bucket, with the signals behind it.
 *
 * Rules, in order (the first that matches wins):
 *
 * 1. `excluded` when the release type is `ai_generated` or `remix`, or any of
 *    its tracks carries `generationMetadata` (platform-generated or remixed
 *    audio), or none of its tracks is `UNDECLARED` + `migration`.
 * 2. `excluded` when no signal of any kind exists (no release date, no ISRC,
 *    no known label, no artist reference or stored artist id): nothing supports an attestation.
 * 3. `needs_review` when a conflicting signal exists (a release date or ISRC
 *    year at or after the cutoff), when the release mixes `UNDECLARED` tracks
 *    with tracks declared at another level or source, or when only one
 *    category of evidence is present.
 * 4. `proposed` when there is BOTH date evidence (release date before the
 *    cutoff, or every track ISRC year before the cutoff with at least one
 *    ISRC) AND provenance evidence (a known label, a stored MusicBrainz/
 *    Wikidata artist id matched with high or medium confidence, or, when no
 *    such id is stored, an artist profile URL on those hosts) and nothing
 *    conflicts.
 *
 * A date alone is never enough to propose: anyone can type a release date.
 */
export function classifyAttestationCandidate(
  release: AttestationCandidateRelease,
  now: Date = new Date(),
): AttestationClassification {
  const signals: AttestationSignal[] = [];
  const reasons: AttestationReasonCode[] = [];
  const undeclared = release.tracks.filter(isUndeclaredMigration);
  const cutoffDay = GENERATIVE_AI_ERA_CUTOFF.toISOString().slice(0, 10);

  // Signals are always collected so the report is useful even for exclusions.
  if (release.releaseDate) {
    const iso = release.releaseDate.toISOString().slice(0, 10);
    if (release.releaseDate.getTime() < GENERATIVE_AI_ERA_CUTOFF.getTime()) {
      signals.push({
        code: "release_date_before_cutoff",
        kind: "supporting",
        detail: `release date ${iso} is before ${cutoffDay}`,
      });
    } else {
      signals.push({
        code: "release_date_on_or_after_cutoff",
        kind: "conflicting",
        detail: `release date ${iso} is not before ${cutoffDay}`,
      });
    }
  }

  const isrcYears = release.tracks
    .map((track) => isrcReferenceYear(track.isrc, now))
    .filter((year): year is number => year !== null);
  if (isrcYears.length > 0) {
    const cutoffYear = GENERATIVE_AI_ERA_CUTOFF.getUTCFullYear();
    const late = isrcYears.filter((year) => year >= cutoffYear);
    if (late.length > 0) {
      signals.push({
        code: "isrc_year_on_or_after_cutoff",
        kind: "conflicting",
        detail: `${late.length} of ${isrcYears.length} ISRC year(s) are ${cutoffYear} or later`,
      });
    } else {
      signals.push({
        code: "isrc_year_before_cutoff",
        kind: "supporting",
        detail: `${isrcYears.length} ISRC year(s), earliest ${Math.min(...isrcYears)}, latest ${Math.max(...isrcYears)}, all before ${cutoffYear}`,
      });
    }
  }

  if (isKnownLabel(release.label)) {
    signals.push({
      code: "known_label",
      kind: "supporting",
      detail: `label "${(release.label ?? "").trim()}"`,
    });
  }

  // #2258: stored ids first; the URL-host inference only when there are none
  // (or the stored match is too weak to count).
  const storedIds = storedArtistIdSignal(release.artist);
  if (storedIds) {
    const ids = [
      `MusicBrainz ${storedIds.musicbrainzArtistId}`,
      ...(storedIds.wikidataQid ? [`Wikidata ${storedIds.wikidataQid}`] : []),
    ].join(", ");
    const matched = storedIds.matchedAt
      ? `, matched ${storedIds.matchedAt.toISOString().slice(0, 10)}`
      : "";
    signals.push({
      code: "artist_external_id",
      kind: "supporting",
      detail: `artist matched ${ids} (${storedIds.confidence} confidence${matched})`,
    });
  } else {
    const hosts = artistReferenceHosts(release.artist);
    if (hosts.length > 0) {
      signals.push({
        code: "artist_external_reference",
        kind: "supporting",
        detail: `artist profile references ${hosts.join(", ")}`,
      });
    }
  }

  const has = (code: AttestationSignalCode) =>
    signals.some((signal) => signal.code === code);

  // Rule 1: hard exclusions.
  if (release.type === "ai_generated") reasons.push("ai_generated_release");
  if (release.type === "remix") reasons.push("remix_release");
  if (release.tracks.some((track) => track.hasGenerationMetadata)) {
    reasons.push("has_generation_metadata");
  }
  if (undeclared.length === 0) reasons.push("no_undeclared_migration_tracks");

  let bucket: AttestationBucket;
  if (reasons.length > 0) {
    bucket = "excluded";
  } else if (signals.length === 0) {
    // Rule 2.
    bucket = "excluded";
    reasons.push("no_supporting_signal");
  } else {
    // Rules 3 and 4.
    const dateEvidence =
      has("release_date_before_cutoff") ||
      (has("isrc_year_before_cutoff") && !has("isrc_year_on_or_after_cutoff"));
    const provenanceEvidence =
      has("known_label") ||
      has("artist_external_id") ||
      has("artist_external_reference");
    const conflicting = signals.some((signal) => signal.kind === "conflicting");
    const mixed = undeclared.length !== release.tracks.length;

    if (conflicting) reasons.push("conflicting_signals");
    if (mixed) reasons.push("mixed_declarations");
    if (!dateEvidence) reasons.push("missing_date_evidence");
    if (!provenanceEvidence) reasons.push("missing_provenance_evidence");

    bucket =
      !conflicting && !mixed && dateEvidence && provenanceEvidence
        ? "proposed"
        : "needs_review";
  }

  return {
    releaseId: release.id,
    title: release.title,
    primaryArtist: release.primaryArtist,
    artistId: release.artist?.id ?? null,
    artistName: release.artist?.displayName ?? null,
    label: release.label,
    releaseDate: release.releaseDate ? release.releaseDate.toISOString() : null,
    releaseType: release.type,
    trackCount: release.tracks.length,
    undeclaredTrackCount: undeclared.length,
    bucket,
    reasons,
    signals,
  };
}

export type AttestationCandidateReport = {
  generatedAt: string;
  rulesVersion: string;
  cutoff: string;
  counts: Record<AttestationBucket, number> & { total: number };
  /** A manifest of the proposed releases; a person still reviews it. */
  manifestDraft: { releaseIds: string[] };
  releases: AttestationClassification[];
};

export function buildAttestationReport(
  releases: AttestationCandidateRelease[],
  now: Date = new Date(),
): AttestationCandidateReport {
  const classified = releases
    .map((release) => classifyAttestationCandidate(release, now))
    .sort(
      (left, right) =>
        left.bucket.localeCompare(right.bucket) ||
        (left.primaryArtist ?? "").localeCompare(right.primaryArtist ?? "") ||
        left.releaseId.localeCompare(right.releaseId),
    );
  const counts = { proposed: 0, needs_review: 0, excluded: 0, total: classified.length };
  for (const entry of classified) counts[entry.bucket] += 1;
  return {
    generatedAt: now.toISOString(),
    rulesVersion: ATTESTATION_RULES_VERSION,
    cutoff: GENERATIVE_AI_ERA_CUTOFF.toISOString(),
    counts,
    manifestDraft: {
      releaseIds: classified
        .filter((entry) => entry.bucket === "proposed")
        .map((entry) => entry.releaseId),
    },
    releases: classified,
  };
}

const REPORT_BATCH_SIZE = 500;

/**
 * Read-only: every release with at least one `UNDECLARED` track. Pages by
 * release id so a large catalog never loads at once.
 */
export async function loadAttestationCandidates(
  db: PrismaClient,
  options: { batchSize?: number } = {},
): Promise<AttestationCandidateRelease[]> {
  const batchSize = options.batchSize ?? REPORT_BATCH_SIZE;
  const out: AttestationCandidateRelease[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await db.release.findMany({
      where: { tracks: { some: { aiDisclosureLevel: "UNDECLARED" } } },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        type: true,
        primaryArtist: true,
        label: true,
        releaseDate: true,
        artist: {
          select: {
            id: true,
            displayName: true,
            imageUrl: true,
            website: true,
            socialLinks: true,
            musicbrainzArtistId: true,
            wikidataQid: true,
            externalIdMatchConfidence: true,
            externalIdMatchedAt: true,
          },
        },
        tracks: {
          select: {
            id: true,
            isrc: true,
            aiDisclosureLevel: true,
            aiDisclosureSource: true,
            generationMetadata: true,
          },
        },
      },
    });
    if (page.length === 0) break;
    for (const release of page) {
      out.push({
        id: release.id,
        title: release.title,
        type: release.type,
        primaryArtist: release.primaryArtist,
        label: release.label,
        releaseDate: release.releaseDate,
        artist: release.artist,
        tracks: release.tracks.map((track) => ({
          id: track.id,
          isrc: track.isrc,
          aiDisclosureLevel: track.aiDisclosureLevel,
          aiDisclosureSource: track.aiDisclosureSource,
          hasGenerationMetadata: track.generationMetadata !== null,
        })),
      });
    }
    cursor = page[page.length - 1].id;
    if (page.length < batchSize) break;
  }
  return out;
}

export async function runAttestationCandidateReport(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<AttestationCandidateReport> {
  return buildAttestationReport(await loadAttestationCandidates(db), now);
}

/** Counts per bucket plus reason tallies: what the operator reads first. */
export function formatAttestationReportSummary(
  report: AttestationCandidateReport,
): string {
  const lines = [
    `AI disclosure attestation candidates (rules ${report.rulesVersion}, cutoff ${report.cutoff.slice(0, 10)})`,
    `releases with UNDECLARED tracks: ${report.counts.total}`,
    `  proposed:     ${report.counts.proposed}`,
    `  needs_review: ${report.counts.needs_review}`,
    `  excluded:     ${report.counts.excluded}`,
  ];
  const reasonCounts = new Map<string, number>();
  for (const entry of report.releases) {
    for (const reason of entry.reasons) {
      const key = `${entry.bucket}:${reason}`;
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  if (reasonCounts.size > 0) {
    lines.push("reasons:");
    for (const [key, count] of Array.from(reasonCounts.entries()).sort()) {
      lines.push(`  ${key} = ${count}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export class AttestationManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationManifestError";
  }
}

/**
 * The reviewed manifest: a JSON array of release ids, or an object with a
 * `releaseIds` array (the shape of `manifestDraft` in the report). Anything
 * else is rejected rather than guessed at. Duplicates collapse.
 */
export function parseAttestationManifest(raw: unknown): { releaseIds: string[] } {
  const list =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { releaseIds?: unknown }).releaseIds
      : raw;
  if (!Array.isArray(list)) {
    throw new AttestationManifestError(
      "Manifest must be a JSON array of release ids or an object with a releaseIds array.",
    );
  }
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new AttestationManifestError(
        "Manifest release ids must be non-empty strings.",
      );
    }
    ids.push(entry.trim());
  }
  return { releaseIds: Array.from(new Set(ids)) };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type TrackSkipReason =
  | "has_generation_metadata"
  | "already_declared"
  | "unexpected_source";

export type ReleaseSkipReason =
  | "release_not_found"
  | "ai_generated_release"
  | "remix_release"
  | "no_eligible_tracks";

/** `already_attested` is the idempotent no-op, not a failed guard. */
export function trackAttestationDecision(
  track: Pick<
    AttestationCandidateTrack,
    "aiDisclosureLevel" | "aiDisclosureSource" | "hasGenerationMetadata"
  >,
): "eligible" | "already_attested" | TrackSkipReason {
  if (track.hasGenerationMetadata) return "has_generation_metadata";
  if (
    track.aiDisclosureLevel === "NONE" &&
    track.aiDisclosureSource === CATALOG_ATTESTATION_SOURCE
  ) {
    return "already_attested";
  }
  if (track.aiDisclosureLevel !== "UNDECLARED") return "already_declared";
  if (track.aiDisclosureSource !== "migration") return "unexpected_source";
  return "eligible";
}

export type AttestationApplyResult = {
  dryRun: boolean;
  manifestReleases: number;
  releasesWithEligibleTracks: number;
  /** Tracks that pass every guard. In a dry run these are "would change". */
  tracksEligible: number;
  /** Tracks actually written. Always 0 in a dry run. */
  tracksUpdated: number;
  /** Tracks already `NONE` + `catalog_attestation` (the idempotent no-op). */
  tracksAlreadyAttested: number;
  eventsEmitted: number;
  skippedReleases: Array<{ releaseId: string; reason: ReleaseSkipReason }>;
  skippedTracks: Array<{
    releaseId: string;
    trackId: string;
    reason: TrackSkipReason;
  }>;
  updatedTrackIds: string[];
};

export type AttestationEventEmitter = (
  event: CatalogAiDisclosureRecordedEvent,
) => void | Promise<void>;

export type ApplyAttestationOptions = {
  releaseIds: string[];
  /** Writing requires an explicit `true`. The default is a dry run. */
  apply?: boolean;
  emit?: AttestationEventEmitter;
  now?: Date;
};

/**
 * Attest the manifest's releases. Guards, all re-checked here and again inside
 * the write (so a concurrent change between read and write cannot slip past):
 *
 * - the release exists and is not `ai_generated` or `remix`;
 * - the track is `UNDECLARED` with source `"migration"`;
 * - the track has no `generationMetadata`.
 *
 * Eligible tracks become `NONE`, no facets, source `catalog_attestation`,
 * the current disclosure schema version and `aiDeclaredAt = now`. A second
 * run finds nothing eligible and changes nothing. Per changed track the
 * existing `catalog.ai_disclosure_recorded` event is emitted with identifiers,
 * level and source only. Manifest entries failing a guard are skipped and
 * reported, never silently dropped.
 */
export async function applyCatalogAttestation(
  db: PrismaClient,
  options: ApplyAttestationOptions,
): Promise<AttestationApplyResult> {
  const apply = options.apply === true;
  const now = options.now ?? new Date();
  const releaseIds = Array.from(new Set(options.releaseIds));

  const result: AttestationApplyResult = {
    dryRun: !apply,
    manifestReleases: releaseIds.length,
    releasesWithEligibleTracks: 0,
    tracksEligible: 0,
    tracksUpdated: 0,
    tracksAlreadyAttested: 0,
    eventsEmitted: 0,
    skippedReleases: [],
    skippedTracks: [],
    updatedTrackIds: [],
  };

  for (const releaseId of releaseIds) {
    const release = await db.release.findUnique({
      where: { id: releaseId },
      select: {
        id: true,
        type: true,
        tracks: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: {
            id: true,
            aiDisclosureLevel: true,
            aiDisclosureSource: true,
            generationMetadata: true,
          },
        },
      },
    });
    if (!release) {
      result.skippedReleases.push({ releaseId, reason: "release_not_found" });
      continue;
    }
    if (release.type === "ai_generated") {
      result.skippedReleases.push({ releaseId, reason: "ai_generated_release" });
      continue;
    }
    if (release.type === "remix") {
      result.skippedReleases.push({ releaseId, reason: "remix_release" });
      continue;
    }

    const eligible: string[] = [];
    let alreadyAttested = 0;
    for (const track of release.tracks) {
      const decision = trackAttestationDecision({
        aiDisclosureLevel: track.aiDisclosureLevel,
        aiDisclosureSource: track.aiDisclosureSource,
        hasGenerationMetadata: track.generationMetadata !== null,
      });
      if (decision === "eligible") eligible.push(track.id);
      else if (decision === "already_attested") alreadyAttested += 1;
      else result.skippedTracks.push({ releaseId, trackId: track.id, reason: decision });
    }
    result.tracksAlreadyAttested += alreadyAttested;

    if (eligible.length === 0) {
      // A fully attested release is a clean idempotent no-op, not a skip.
      if (alreadyAttested === 0) {
        result.skippedReleases.push({ releaseId, reason: "no_eligible_tracks" });
      }
      continue;
    }
    result.releasesWithEligibleTracks += 1;
    result.tracksEligible += eligible.length;
    if (!apply) continue;

    const changed = await db.$transaction(async (tx) => {
      const done: string[] = [];
      for (const trackId of eligible) {
        const updated = await tx.track.updateMany({
          where: {
            id: trackId,
            releaseId,
            aiDisclosureLevel: "UNDECLARED",
            aiDisclosureSource: "migration",
            generationMetadata: { equals: Prisma.DbNull },
            release: { type: { notIn: ["ai_generated", "remix"] } },
          },
          data: {
            aiDisclosureLevel: "NONE",
            aiContributionFacets: [],
            aiDisclosureSource: CATALOG_ATTESTATION_SOURCE,
            aiDisclosureVersion: AI_DISCLOSURE_VERSION,
            aiDeclaredAt: now,
          },
        });
        if (updated.count === 1) done.push(trackId);
      }
      return done;
    });

    result.tracksUpdated += changed.length;
    result.updatedTrackIds.push(...changed);
    for (const trackId of changed) {
      if (!options.emit) continue;
      await options.emit({
        eventName: "catalog.ai_disclosure_recorded",
        eventVersion: 1,
        occurredAt: now.toISOString(),
        releaseId,
        trackId,
        level: "NONE",
        source: CATALOG_ATTESTATION_SOURCE,
        facets: [],
      });
      result.eventsEmitted += 1;
    }
  }

  return result;
}

export function formatAttestationApplySummary(
  result: AttestationApplyResult,
): string {
  const lines = [
    result.dryRun
      ? "DRY RUN: nothing was written (pass --apply to write)"
      : "APPLIED",
    `manifest releases:               ${result.manifestReleases}`,
    `releases with eligible tracks:   ${result.releasesWithEligibleTracks}`,
    `tracks eligible:                 ${result.tracksEligible}`,
    `tracks updated:                  ${result.tracksUpdated}`,
    `tracks already attested:         ${result.tracksAlreadyAttested}`,
    `events emitted:                  ${result.eventsEmitted}`,
    `skipped releases:                ${result.skippedReleases.length}`,
    `skipped tracks:                  ${result.skippedTracks.length}`,
  ];
  for (const skipped of result.skippedReleases) {
    lines.push(`  skipped release ${skipped.releaseId}: ${skipped.reason}`);
  }
  for (const skipped of result.skippedTracks) {
    lines.push(
      `  skipped track ${skipped.trackId} (release ${skipped.releaseId}): ${skipped.reason}`,
    );
  }
  return lines.join("\n");
}
