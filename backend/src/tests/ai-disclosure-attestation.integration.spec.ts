/**
 * #2252 catalog attestation - Testcontainers integration test.
 *
 * Real Prisma against the self-contained Postgres container. Covers report
 * bucketing, the apply guards, idempotence, dry-run, the analytics audit
 * trail, and the public catalog response for attested tracks.
 */
import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import type { CatalogAiDisclosureRecordedEvent } from "../events/event_types";
import {
  AI_DISCLOSURE_VERSION,
  CATALOG_ATTESTATION_SOURCE,
} from "../modules/catalog/ai-disclosure.policy";
import {
  applyCatalogAttestation,
  loadAttestationCandidates,
  runAttestationCandidateReport,
} from "../modules/catalog/ai-disclosure-attestation";
import { CatalogService } from "../modules/catalog/catalog.service";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { EventBus } from "../modules/shared/event_bus";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { buildAnalyticsEmitter } from "../scripts/apply_ai_disclosure_attestation";

const TEST_PREFIX = `attest_${Date.now()}_`;
const id = (name: string) => `${TEST_PREFIX}${name}`;
const COMMONS_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Known.jpg";
const LEGACY = { aiDisclosureLevel: "UNDECLARED" as const, aiDisclosureSource: "migration" };

async function seedRelease(input: {
  name: string;
  type?: string;
  artistId?: string;
  label?: string;
  releaseDate?: Date;
  tracks: Array<{
    name: string;
    isrc?: string;
    generationMetadata?: object;
    level?: "UNDECLARED" | "NONE" | "PARTLY" | "ALL";
    source?: string;
  }>;
}) {
  await prisma.release.create({
    data: {
      id: id(input.name),
      artistId: input.artistId ?? id("artist_plain"),
      title: `${TEST_PREFIX}${input.name} title`,
      status: "ready",
      type: input.type ?? "album",
      primaryArtist: `${TEST_PREFIX}${input.name} artist`,
      label: input.label,
      releaseDate: input.releaseDate,
    },
  });
  let position = 1;
  for (const track of input.tracks) {
    await prisma.track.create({
      data: {
        id: id(track.name),
        releaseId: id(input.name),
        title: `${TEST_PREFIX}${track.name}`,
        position: position++,
        isrc: track.isrc,
        processingStatus: "complete",
        generationMetadata: track.generationMetadata,
        aiDisclosureLevel: track.level ?? "UNDECLARED",
        aiDisclosureSource: track.source ?? "migration",
      },
    });
  }
}

async function trackState(name: string) {
  return prisma.track.findUniqueOrThrow({
    where: { id: id(name) },
    select: {
      aiDisclosureLevel: true,
      aiContributionFacets: true,
      aiDisclosureSource: true,
      aiDisclosureVersion: true,
      aiDeclaredAt: true,
    },
  });
}

describe("catalog AI disclosure attestation (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: id("user"), email: `${id("user")}@test.resonate` },
    });
    await prisma.artist.createMany({
      data: [
        { id: id("artist_plain"), displayName: `${TEST_PREFIX}Plain Artist`, userId: id("user") },
        { id: id("artist_commons"), displayName: `${TEST_PREFIX}Commons Artist`, imageUrl: COMMONS_IMAGE },
      ],
    });

    // Proposed: pre-cutoff date + known label.
    await seedRelease({
      name: "known",
      label: "Sony Music",
      releaseDate: new Date("2015-06-01"),
      tracks: [{ name: "known_t1" }, { name: "known_t2" }],
    });
    // Proposed: ISRC years + artist reference, no date or label.
    await seedRelease({
      name: "isrc_artist",
      artistId: id("artist_commons"),
      tracks: [{ name: "isrc_artist_t1", isrc: "USRC11900001" }],
    });
    // Needs review: a date alone.
    await seedRelease({
      name: "date_only",
      releaseDate: new Date("2012-01-01"),
      tracks: [{ name: "date_only_t1" }],
    });
    // Excluded: no signal at all.
    await seedRelease({ name: "no_signal", tracks: [{ name: "no_signal_t1" }] });
    // Excluded types, strong signals notwithstanding.
    await seedRelease({
      name: "ai_release",
      type: "ai_generated",
      label: "Sony Music",
      releaseDate: new Date("2015-06-01"),
      tracks: [{ name: "ai_release_t1" }],
    });
    await seedRelease({
      name: "remix_release",
      type: "remix",
      label: "Sony Music",
      releaseDate: new Date("2015-06-01"),
      tracks: [{ name: "remix_release_t1" }],
    });
    // Excluded by generationMetadata on one track; the clean sibling must stay.
    await seedRelease({
      name: "genmeta",
      label: "Sony Music",
      releaseDate: new Date("2015-06-01"),
      tracks: [
        { name: "genmeta_clean" },
        { name: "genmeta_generated", generationMetadata: { provider: "lyria", prompt: "x" } },
      ],
    });
    // Not in any manifest.
    await seedRelease({
      name: "not_listed",
      label: "Sony Music",
      releaseDate: new Date("2015-06-01"),
      tracks: [{ name: "not_listed_t1" }],
    });
    // Mixed: one undeclared track beside an artist-declared one. The artist's
    // declaration must survive the batch.
    await seedRelease({
      name: "mixed",
      label: "Sony Music",
      releaseDate: new Date("2015-06-01"),
      tracks: [
        { name: "mixed_undeclared" },
        { name: "mixed_declared", level: "PARTLY", source: "artist" },
      ],
    });
    // Already declared by its artist: has no UNDECLARED track, so it never
    // shows up in the report and the apply guard skips it.
    await seedRelease({
      name: "artist_declared",
      tracks: [{ name: "artist_declared_t1", level: "ALL", source: "artist" }],
    });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { subjectId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { releaseId: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  describe("report", () => {
    it("places every UNDECLARED release in exactly one bucket with its signals", async () => {
      const report = await runAttestationCandidateReport(prisma);
      const ours = report.releases.filter((entry) => entry.releaseId.startsWith(TEST_PREFIX));
      const bucketOf = (name: string) =>
        ours.find((entry) => entry.releaseId === id(name));

      // artist_declared has no UNDECLARED track so it is not a candidate.
      expect(ours.map((entry) => entry.releaseId).sort()).toEqual(
        [
          "known", "isrc_artist", "date_only", "no_signal", "ai_release",
          "remix_release", "genmeta", "not_listed", "mixed",
        ].map(id).sort(),
      );
      expect(new Set(ours.map((entry) => entry.releaseId)).size).toBe(ours.length);

      expect(bucketOf("known")).toMatchObject({ bucket: "proposed", undeclaredTrackCount: 2 });
      expect(bucketOf("known")?.signals.map((signal) => signal.code)).toEqual([
        "release_date_before_cutoff",
        "known_label",
      ]);
      expect(bucketOf("isrc_artist")?.bucket).toBe("proposed");
      expect(bucketOf("isrc_artist")?.signals.map((signal) => signal.code)).toEqual([
        "isrc_year_before_cutoff",
        "artist_external_reference",
      ]);
      expect(bucketOf("not_listed")?.bucket).toBe("proposed");
      expect(bucketOf("date_only")).toMatchObject({
        bucket: "needs_review",
        reasons: ["missing_provenance_evidence"],
      });
      expect(bucketOf("mixed")).toMatchObject({
        bucket: "needs_review",
        reasons: ["mixed_declarations"],
      });
      expect(bucketOf("no_signal")).toMatchObject({
        bucket: "excluded",
        reasons: ["no_supporting_signal"],
      });
      expect(bucketOf("ai_release")).toMatchObject({
        bucket: "excluded",
        reasons: ["ai_generated_release"],
      });
      expect(bucketOf("remix_release")).toMatchObject({
        bucket: "excluded",
        reasons: ["remix_release"],
      });
      expect(bucketOf("genmeta")).toMatchObject({
        bucket: "excluded",
        reasons: ["has_generation_metadata"],
      });

      const draft = new Set(report.manifestDraft.releaseIds);
      for (const name of ["known", "isrc_artist", "not_listed"]) expect(draft.has(id(name))).toBe(true);
      for (const name of ["date_only", "mixed", "no_signal", "ai_release", "remix_release", "genmeta"]) {
        expect(draft.has(id(name))).toBe(false);
      }
    });

    it("is read-only and pages through releases", async () => {
      const before = await prisma.track.count({ where: { releaseId: { startsWith: TEST_PREFIX } } });
      const paged = await loadAttestationCandidates(prisma, { batchSize: 2 });
      const unpaged = await loadAttestationCandidates(prisma, { batchSize: 1000 });

      expect(paged.map((entry) => entry.id)).toEqual(unpaged.map((entry) => entry.id));
      expect(
        await prisma.track.count({
          where: { releaseId: { startsWith: TEST_PREFIX }, aiDisclosureSource: CATALOG_ATTESTATION_SOURCE },
        }),
      ).toBe(0);
      expect(await prisma.track.count({ where: { releaseId: { startsWith: TEST_PREFIX } } })).toBe(before);
    });
  });

  describe("apply", () => {
    const manifest = [
      "known", "isrc_artist", "ai_release", "remix_release", "genmeta",
      "artist_declared", "mixed",
    ].map(id).concat([id("does_not_exist")]);

    it("writes nothing in a dry run, which is the default", async () => {
      const emitted: CatalogAiDisclosureRecordedEvent[] = [];
      const result = await applyCatalogAttestation(prisma, {
        releaseIds: manifest,
        emit: (event) => void emitted.push(event),
      });

      expect(result.dryRun).toBe(true);
      expect(result.tracksUpdated).toBe(0);
      expect(result.eventsEmitted).toBe(0);
      expect(emitted).toEqual([]);
      // known (2) + isrc_artist (1) + genmeta_clean (1) + mixed_undeclared (1)
      expect(result.tracksEligible).toBe(5);
      for (const name of ["known_t1", "known_t2", "isrc_artist_t1", "genmeta_clean", "mixed_undeclared"]) {
        expect(await trackState(name)).toMatchObject(LEGACY);
      }
    });

    it("changes only guard-passing manifest tracks and reports every skip", async () => {
      const emitted: CatalogAiDisclosureRecordedEvent[] = [];
      const now = new Date("2026-10-25T09:00:00.000Z");
      const result = await applyCatalogAttestation(prisma, {
        releaseIds: manifest,
        apply: true,
        now,
        emit: (event) => void emitted.push(event),
      });

      expect(result.dryRun).toBe(false);
      expect(result.tracksUpdated).toBe(5);
      expect(result.eventsEmitted).toBe(5);
      expect([...result.updatedTrackIds].sort()).toEqual(
        ["known_t1", "known_t2", "isrc_artist_t1", "genmeta_clean", "mixed_undeclared"].map(id).sort(),
      );

      for (const name of ["known_t1", "known_t2", "isrc_artist_t1", "genmeta_clean", "mixed_undeclared"]) {
        expect(await trackState(name)).toEqual({
          aiDisclosureLevel: "NONE",
          aiContributionFacets: [],
          aiDisclosureSource: "catalog_attestation",
          aiDisclosureVersion: AI_DISCLOSURE_VERSION,
          aiDeclaredAt: now,
        });
      }

      // Untouched: ai_generated, remix, generationMetadata, not in manifest,
      // and tracks already declared by someone else.
      for (const name of ["ai_release_t1", "remix_release_t1", "genmeta_generated", "not_listed_t1", "date_only_t1", "no_signal_t1"]) {
        expect(await trackState(name)).toMatchObject(LEGACY);
      }
      expect(await trackState("mixed_declared")).toMatchObject({
        aiDisclosureLevel: "PARTLY",
        aiDisclosureSource: "artist",
      });
      expect(await trackState("artist_declared_t1")).toMatchObject({
        aiDisclosureLevel: "ALL",
        aiDisclosureSource: "artist",
      });

      expect(result.skippedReleases).toEqual(
        expect.arrayContaining([
          { releaseId: id("ai_release"), reason: "ai_generated_release" },
          { releaseId: id("remix_release"), reason: "remix_release" },
          { releaseId: id("does_not_exist"), reason: "release_not_found" },
          { releaseId: id("artist_declared"), reason: "no_eligible_tracks" },
        ]),
      );
      expect(result.skippedTracks).toEqual(
        expect.arrayContaining([
          { releaseId: id("genmeta"), trackId: id("genmeta_generated"), reason: "has_generation_metadata" },
          { releaseId: id("mixed"), trackId: id("mixed_declared"), reason: "already_declared" },
        ]),
      );

      // One event per changed track, identifiers + level + source only.
      expect(emitted).toHaveLength(5);
      expect(emitted[0]).toEqual({
        eventName: "catalog.ai_disclosure_recorded",
        eventVersion: 1,
        occurredAt: now.toISOString(),
        releaseId: expect.stringContaining(TEST_PREFIX),
        trackId: expect.stringContaining(TEST_PREFIX),
        level: "NONE",
        source: "catalog_attestation",
        facets: [],
      });
    });

    it("is idempotent: a second run changes and emits nothing", async () => {
      const before = await trackState("known_t1");
      const emitted: CatalogAiDisclosureRecordedEvent[] = [];
      const result = await applyCatalogAttestation(prisma, {
        releaseIds: manifest,
        apply: true,
        now: new Date("2027-01-01T00:00:00.000Z"),
        emit: (event) => void emitted.push(event),
      });

      expect(result.tracksUpdated).toBe(0);
      expect(result.tracksEligible).toBe(0);
      expect(result.eventsEmitted).toBe(0);
      expect(emitted).toEqual([]);
      expect(result.tracksAlreadyAttested).toBe(5);
      // aiDeclaredAt keeps its first value: the audit timestamp is not rewritten.
      expect(await trackState("known_t1")).toEqual(before);
      // Fully attested releases are a clean no-op, not a skip.
      expect(result.skippedReleases.map((entry) => entry.releaseId)).not.toContain(id("known"));
    });

    it("leaves the inverse statement able to restore the legacy state", async () => {
      const restored = await prisma.$executeRaw`
        UPDATE "Track"
        SET "aiDisclosureLevel" = 'UNDECLARED',
            "aiDisclosureSource" = 'migration',
            "aiDisclosureVersion" = NULL,
            "aiDeclaredAt" = NULL
        WHERE "aiDisclosureLevel" = 'NONE'
          AND "aiDisclosureSource" = 'catalog_attestation'
          AND "releaseId" LIKE ${`${TEST_PREFIX}%`}`;
      expect(restored).toBe(5);
      expect(await trackState("known_t1")).toMatchObject({
        ...LEGACY,
        aiDisclosureVersion: null,
        aiDeclaredAt: null,
      });
    });

    it("records the audit trail through the production analytics bridge", async () => {
      const analytics = buildAnalyticsEmitter();
      try {
        const result = await applyCatalogAttestation(prisma, {
          releaseIds: [id("known")],
          apply: true,
          emit: analytics.emit,
        });
        await analytics.settle();
        expect(result.tracksUpdated).toBe(2);
      } finally {
        analytics.close();
      }

      const rows = await prisma.analyticsEvent.findMany({
        where: { eventName: "catalog.ai_disclosure_recorded", subjectId: { startsWith: TEST_PREFIX } },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].payload).toEqual({
        releaseId: id("known"),
        trackId: expect.stringContaining(TEST_PREFIX),
        level: "NONE",
        source: "catalog_attestation",
        // The bridge drops empty arrays, so a NONE event carries no facets key.
      });
      expect(rows[0]).toMatchObject({ producer: "catalog-service", subjectType: "track" });
    });
  });

  describe("public catalog response", () => {
    it("exposes none / None / catalog_attestation for attested tracks and undeclared for the rest", async () => {
      const configService = new ConfigService({
        ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || "test-encryption-secret-for-integration",
      });
      const encryption = new EncryptionService(
        new AesEncryptionProvider(configService) as any,
        configService,
      );
      const catalog = new CatalogService(
        new EventBus(),
        encryption as any,
        new LocalStorageProvider(),
        new UploadRightsRoutingService(),
      );

      // `known` was attested by the previous test; `not_listed` never was.
      const attested = await catalog.getRelease(id("known"));
      expect(attested?.aiDisclosure).toMatchObject({
        level: "none",
        containsAI: "None",
        source: "catalog_attestation",
        schemaVersion: AI_DISCLOSURE_VERSION,
      });
      for (const track of attested?.tracks ?? []) {
        expect(track.aiDisclosure).toMatchObject({
          level: "none",
          containsAI: "None",
          facets: [],
          source: "catalog_attestation",
        });
      }

      const listed = await catalog.listPublished(500, `${TEST_PREFIX}known artist`);
      expect(listed.map((release) => release.id)).toEqual([id("known")]);
      expect(listed[0].aiDisclosure).toMatchObject({ level: "none", source: "catalog_attestation" });

      const unattested = await catalog.getRelease(id("not_listed"));
      expect(unattested?.aiDisclosure).toMatchObject({
        level: "undeclared",
        containsAI: null,
        label: "AI disclosure unavailable",
      });
    });
  });
});
