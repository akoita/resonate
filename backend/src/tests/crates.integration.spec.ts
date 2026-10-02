/**
 * Crate Digger service — Integration (#1962, docs/rfc/taste-engine.md §5.1-5.2)
 *
 * Real Prisma (Testcontainers Postgres). Seeds a small fixture catalog and
 * checks the #1962 acceptance criteria end to end through CratesService: a text
 * request and a reference-track request resolve to the same filter structure
 * and the response returns the filters; coverage is honest (including "0 of N"
 * with the gaps listed); fully AI recordings appear only when allowed;
 * verifiedHumanOnly works; CrateItem.userId is the owner; the request text is
 * never stored; and another user's crate is a 404.
 *
 * The parser is the deterministic one, so no external AI is involved.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='crates.integration'
 */

import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { CrateEntitlementsService } from "../modules/crates/crate-entitlements";
import { CRATE_REQUEST_MAX_TEXT_LENGTH } from "../modules/crates/crate.types";
import { CRATE_LICENSE_RIGHTS } from "../modules/crates/crate_license_rights";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { deterministicCrateRequestParser } from "../modules/crates/crate_request_parser";
import { CratesService } from "../modules/crates/crates.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const TEST_PREFIX = `crates_${Date.now()}_`;
const DJ = `${TEST_PREFIX}dj`;
const OTHER_DJ = `${TEST_PREFIX}otherdj`;
/** Owns the crates the list, edit and swap scenarios work on. */
const EDITOR = `${TEST_PREFIX}editor`;
const HUMAN_USER = `${TEST_PREFIX}humanartist`;
const PLAIN_USER = `${TEST_PREFIX}plainartist`;
const A_HUMAN = `${TEST_PREFIX}artist_human`;
const A_PLAIN = `${TEST_PREFIX}artist_plain`;

const id = (key: string) => `${TEST_PREFIX}${key}`;

/** Same BPM window for every scenario: all seeded tempos sit inside it. */
const BPM_WINDOW = { min: 126, max: 132 };

function measuredFeatures(tempoBpm: number, camelot: string) {
  return {
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "librosa", version: "0.10" },
    sampleRate: 22050,
    durationSeconds: 200,
    tempoBpm,
    tempoConfidence: 0.8,
    beatCount: 400,
    firstBeatSec: 0.4,
    key: { tonic: "A", mode: "minor", confidence: 0.4 },
    energyRms: 0.15,
    onsetDensity: 4,
    camelot,
  };
}

type SeedStem = {
  type: string;
  pricing?: { base: number; remix: number; commercial: number };
};

type SeedTrack = {
  key: string;
  artistId: string;
  /** Newer day = newer release = earlier in the candidate pool. */
  day: number;
  features?: { tempoBpm: number; camelot: string };
  aiDisclosureLevel?: "NONE" | "PARTLY" | "ALL" | "UNDECLARED";
  releaseStatus?: string;
  contentStatus?: string;
  stems?: SeedStem[];
};

async function seedTrack(spec: SeedTrack) {
  const releaseId = id(`${spec.key}_release`);
  const trackId = id(spec.key);
  await prisma.release.create({
    data: {
      id: releaseId,
      title: `Release ${spec.key}`,
      artistId: spec.artistId,
      status: spec.releaseStatus ?? "published",
      genre: "Techno",
      // Far-future creation dates put the fixture at the head of the pool.
      createdAt: new Date(Date.UTC(2099, 0, spec.day)),
    },
  });
  await prisma.track.create({
    data: {
      id: trackId,
      title: `Track ${spec.key}`,
      releaseId,
      position: 1,
      aiDisclosureLevel: spec.aiDisclosureLevel ?? "NONE",
      contentStatus: spec.contentStatus ?? "clean",
    },
  });
  await prisma.stem.create({
    data: {
      id: id(`${spec.key}_original`),
      trackId,
      type: "original",
      uri: `local://${spec.key}-original.mp3`,
      ...(spec.features
        ? { audioFeatures: measuredFeatures(spec.features.tempoBpm, spec.features.camelot) }
        : {}),
    },
  });
  for (const stem of spec.stems ?? []) {
    const stemId = id(`${spec.key}_${stem.type}`);
    await prisma.stem.create({
      data: { id: stemId, trackId, type: stem.type, uri: `local://${spec.key}-${stem.type}.mp3` },
    });
    if (stem.pricing) {
      await prisma.stemPricing.create({
        data: {
          stemId,
          basePlayPriceUsd: stem.pricing.base,
          remixLicenseUsd: stem.pricing.remix,
          commercialLicenseUsd: stem.pricing.commercial,
        },
      });
    }
  }
}

/** Items of a crate response that belong to this spec's fixture, in crate order. */
function fixtureIds(response: { crate: { items: Array<{ trackId: string }> } }): string[] {
  return response.crate.items
    .map((item) => item.trackId)
    .filter((trackId) => trackId.startsWith(TEST_PREFIX));
}

describe("CratesService (integration)", () => {
  let service: CratesService;

  beforeAll(async () => {
    service = new CratesService(
      deterministicCrateRequestParser,
      new DiscoveryRankingService(),
      new DiscoveryPolicyContextService(),
      new CrateEntitlementsService(),
      new AgentLearningService(),
    );

    for (const userId of [DJ, OTHER_DJ, EDITOR, HUMAN_USER, PLAIN_USER]) {
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    }
    await prisma.artist.create({
      data: {
        id: A_HUMAN,
        userId: HUMAN_USER,
        displayName: "Human Artist",
        payoutAddress: `0x${"A".repeat(40)}`,
      },
    });
    await prisma.artist.create({
      data: {
        id: A_PLAIN,
        userId: PLAIN_USER,
        displayName: "Plain Artist",
        payoutAddress: `0x${"B".repeat(40)}`,
      },
    });
    // The reputation row is keyed by the lowercased user id.
    await prisma.curatorReputation.create({
      data: {
        walletAddress: HUMAN_USER.toLowerCase(),
        humanVerificationStatus: "human_verified",
        humanVerifiedAt: new Date(),
      },
    });

    // t1: the reference track. Verified-human artist, priced drums.
    await seedTrack({
      key: "t1",
      artistId: A_HUMAN,
      day: 20,
      features: { tempoBpm: 128, camelot: "8A" },
      stems: [{ type: "drums", pricing: { base: 0.05, remix: 8, commercial: 20 } }],
    });
    // t2: same key, plain artist, priced vocals.
    await seedTrack({
      key: "t2",
      artistId: A_PLAIN,
      day: 19,
      features: { tempoBpm: 126, camelot: "8A" },
      stems: [{ type: "vocals", pricing: { base: 0.1, remix: 12, commercial: 30 } }],
    });
    // t3: neighbouring key, verified-human artist, no pricing, partly AI.
    await seedTrack({
      key: "t3",
      artistId: A_HUMAN,
      day: 18,
      features: { tempoBpm: 130, camelot: "9A" },
      aiDisclosureLevel: "PARTLY",
      stems: [{ type: "bass" }],
    });
    // t4: fully AI generated.
    await seedTrack({
      key: "t4",
      artistId: A_PLAIN,
      day: 17,
      features: { tempoBpm: 131, camelot: "8A" },
      aiDisclosureLevel: "ALL",
    });
    // t5: no measured features at all.
    await seedTrack({ key: "t5", artistId: A_PLAIN, day: 16 });
    // t6: withdrawn release. t7: quarantined. Neither is ever a candidate.
    await seedTrack({
      key: "t6",
      artistId: A_PLAIN,
      day: 15,
      features: { tempoBpm: 128, camelot: "8A" },
      releaseStatus: "withdrawn",
    });
    await seedTrack({
      key: "t7",
      artistId: A_PLAIN,
      day: 14,
      features: { tempoBpm: 128, camelot: "8A" },
      contentStatus: "quarantined",
    });

    // t3 offers a remix license through an active listing; t2's commercial
    // listing has expired and must not count.
    const listing = (key: string, listingId: number, licenseType: "remix" | "commercial", days: number) =>
      prisma.stemListing.create({
        data: {
          listingId: BigInt(listingId),
          stemId: id(key),
          tokenId: BigInt(listingId),
          chainId: 31337,
          contractAddress: `0x${"C".repeat(40)}`,
          sellerAddress: `0x${"D".repeat(40)}`,
          pricePerUnit: "1000000",
          amount: BigInt(1),
          paymentToken: `0x${"E".repeat(40)}`,
          expiresAt: new Date(Date.now() + days * 86_400_000),
          transactionHash: `0x${TEST_PREFIX.replace(/\W/g, "")}${key}`,
          blockNumber: BigInt(1),
          licenseType,
          status: "active",
          listedAt: new Date(),
        },
      });
    await listing("t3_bass", 9_000_001, "remix", 30);
    await listing("t2_vocals", 9_000_002, "commercial", -1);

    // Stem quality ratings (#1963): t1 drums is rated by two curators (mean
    // 85.5 rounds to 86), t3 bass by one, t2 vocals is unrated.
    const rating = (stemKey: string, curatorUserId: string, score: number) =>
      prisma.stemQualityRating.create({
        data: {
          stemId: id(stemKey),
          curatorUserId,
          score,
          rmsEnergy: 0.1,
          spectralDensity: 0.5,
          silenceRatio: 0.01,
          musicalSalience: 0.6,
          analysisMethod: "test",
        },
      });
    await rating("t1_drums", DJ, 80);
    await rating("t1_drums", OTHER_DJ, 91);
    await rating("t3_bass", DJ, 70);
  });

  afterAll(async () => {
    const ownedBy = { userId: { startsWith: TEST_PREFIX } };
    const stems = await prisma.stem.findMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
      select: { id: true },
    });
    const stemIds = stems.map((stem) => stem.id);
    await prisma.crateItem.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.crateRequest.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.crate.deleteMany({ where: ownedBy }).catch(() => {});
    await prisma.stemQualityRating
      .deleteMany({ where: { stemId: { in: stemIds } } })
      .catch(() => {});
    await prisma.stemListing.deleteMany({ where: { stemId: { in: stemIds } } }).catch(() => {});
    await prisma.stemPricing.deleteMany({ where: { stemId: { in: stemIds } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { id: { in: stemIds } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.curatorReputation
      .deleteMany({ where: { walletAddress: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
  });

  describe("request sources", () => {
    it("a text request and a reference-track request resolve to the same filter structure and return the filters", async () => {
      const text = await service.createFromRequest(DJ, {
        text: "techno 126 to 132 bpm in 8A, 6 tracks",
      });
      const reference = await service.createFromRequest(DJ, { referenceTrackId: id("t1") });

      const structure = Object.keys(defaultCrateFilters()).sort();
      expect(Object.keys(text.crate.filters).sort()).toEqual(structure);
      expect(Object.keys(reference.crate.filters).sort()).toEqual(structure);

      expect(text.request).toMatchObject({ source: "text", parserStrategy: "deterministic" });
      expect(text.crate.filters).toMatchObject({
        count: 6,
        bpm: BPM_WINDOW,
        keys: ["8A"],
        genres: ["Techno"],
      });

      expect(reference.request).toMatchObject({
        source: "reference_track",
        parserStrategy: "deterministic",
        unparsed: [],
      });
      // t1 is 128 BPM, 8A, energy 0.5, Techno.
      expect(reference.crate.filters).toMatchObject({
        bpm: { min: 122.9, max: 133.1 },
        keys: ["8A"],
        includeCamelotNeighbors: true,
        energy: { min: 0.35, max: 0.65 },
        genres: ["Techno"],
      });

      // The filters the crate ran with are the filters that were persisted.
      const stored = await prisma.crate.findUniqueOrThrow({ where: { id: reference.crate.id } });
      expect(stored.filters).toEqual(reference.crate.filters);
      const storedRequest = await prisma.crateRequest.findUniqueOrThrow({
        where: { id: reference.request.id },
      });
      expect(storedRequest).toMatchObject({
        crateId: reference.crate.id,
        source: "reference_track",
        referenceTrackId: id("t1"),
        userId: DJ,
      });
    });

    it("a text request finds the matching tracks and drops fully AI, withdrawn and quarantined ones", async () => {
      const response = await service.createFromRequest(DJ, {
        text: "techno 126 to 132 bpm in 8A",
        count: 25,
      });
      // 8A plus its neighbours (9A): t1, t2 and t3. t4 is fully AI, t5 has no
      // measured features, t6 is withdrawn and t7 is quarantined.
      expect(new Set(fixtureIds(response))).toEqual(new Set([id("t1"), id("t2"), id("t3")]));
      expect(response.crate.status).toBe("draft");
      expect(response.crate.title).toBeNull();
      expect(response.crate.items.map((item) => item.position)).toEqual(
        response.crate.items.map((_, index) => index),
      );
    });

    it("a reference-track request excludes the reference track and keeps the line facts honest", async () => {
      const response = await service.createFromRequest(DJ, { referenceTrackId: id("t1"), count: 25 });
      expect(new Set(fixtureIds(response))).toEqual(new Set([id("t2"), id("t3")]));

      const t3 = response.crate.items.find((item) => item.trackId === id("t3"));
      expect(t3).toMatchObject({
        title: "Track t3",
        artistId: A_HUMAN,
        artistName: "Human Artist",
        available: true,
        tempoBpm: 130,
        camelot: "9A",
        stemTypes: ["bass"],
        listedLicenseTypes: ["remix"],
        // No StemPricing: no tier is guessed and the line has no known price.
        linePriceUsd: null,
        verifiedHuman: true,
        aiDisclosureLevel: "PARTLY",
      });
      expect(t3?.indicativePriceUsd).toEqual({});
      expect(Array.isArray(t3?.explanation)).toBe(true);
    });

    it("a reference track that is not publicly available is a 404", async () => {
      await expect(
        service.createFromRequest(DJ, { referenceTrackId: id("t6") }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createFromRequest(DJ, { referenceTrackId: id("t7") }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createFromRequest(DJ, { referenceTrackId: id("does_not_exist") }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a filters request runs the sanitized filters and counts come from the filters", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 2, bpm: BPM_WINDOW, keys: ["8A"], includeCamelotNeighbors: false },
      });
      expect(response.request).toMatchObject({ source: "filters", parserStrategy: "deterministic" });
      expect(response.crate.filters).toMatchObject({
        count: 2,
        bpm: BPM_WINDOW,
        keys: ["8A"],
        includeCamelotNeighbors: false,
      });
      expect(response.coverage.requested).toBe(2);
      expect(response.crate.items.length).toBeLessThanOrEqual(2);
    });

    it("an explicit count overrides the parsed count within bounds", async () => {
      const response = await service.createFromRequest(DJ, {
        text: "techno 126 to 132 bpm",
        count: 3,
      });
      expect(response.crate.filters.count).toBe(3);
      expect(response.coverage.requested).toBe(3);
    });
  });

  describe("input validation", () => {
    it("requires exactly one of text, referenceTrackId and filters", async () => {
      await expect(service.createFromRequest(DJ, {})).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createFromRequest(DJ, { text: "techno", referenceTrackId: id("t1") }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createFromRequest(DJ, { text: "techno", filters: {} }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects text over the length bound and blank text", async () => {
      await expect(
        service.createFromRequest(DJ, { text: "x".repeat(CRATE_REQUEST_MAX_TEXT_LENGTH + 1) }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createFromRequest(DJ, { text: "   " })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("rejects invalid edited filters with fixed codes", async () => {
      const error = await service
        .createFromRequest(DJ, { filters: { licenseType: "bogus-license" } })
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        errors: string[];
      };
      expect(body.code).toBe("invalid_filters");
      expect(body.errors).toEqual(["invalid_license_type"]);
      expect(JSON.stringify(body)).not.toContain("bogus-license");
    });
  });

  describe("coverage", () => {
    it("reports found of requested and the filter that left the gap", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 5, bpm: BPM_WINDOW, keys: ["8A"], includeCamelotNeighbors: false },
      });
      expect(response.coverage.requested).toBe(5);
      // t1 and t2 are 8A; t3 (9A) is the only one a looser key would add.
      expect(new Set(fixtureIds(response))).toEqual(new Set([id("t1"), id("t2")]));
      expect(response.coverage.found).toBe(response.crate.items.length);
      expect(response.coverage.gaps.map((gap) => gap.filter)).toContain("keys");

      const stored = await prisma.crateRequest.findUniqueOrThrow({
        where: { id: response.request.id },
      });
      expect(stored.requestedCount).toBe(5);
      expect(stored.foundCount).toBe(response.coverage.found);
      expect(stored.unmetFilters).toEqual(response.coverage.gaps.map((gap) => gap.filter));
    });

    it("an unsatisfiable request is an empty crate: 0 of N with the gaps listed", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 5, bpm: { min: 200, max: 210 } },
      });
      expect(response.crate.items).toEqual([]);
      expect(response.coverage.requested).toBe(5);
      expect(response.coverage.found).toBe(0);
      expect(response.coverage.gaps[0]).toMatchObject({ filter: "bpm" });
      expect(response.coverage.gaps[0].wouldAdd).toBeGreaterThan(0);

      // The empty crate is still persisted, with the unmet demand recorded.
      const stored = await prisma.crateRequest.findUniqueOrThrow({
        where: { id: response.request.id },
      });
      expect(stored).toMatchObject({ requestedCount: 5, foundCount: 0, unmetFilters: ["bpm"] });
      expect(await prisma.crateItem.count({ where: { crateId: response.crate.id } })).toBe(0);
    });
  });

  describe("fully AI recordings", () => {
    it("appear only when the request allows them", async () => {
      const without = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW },
      });
      expect(fixtureIds(without)).not.toContain(id("t4"));
      expect(without.crate.items.every((item) => item.aiDisclosureLevel !== "ALL")).toBe(true);

      const withAi = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW, allowFullyAi: true },
      });
      expect(fixtureIds(withAi)).toContain(id("t4"));
      expect(withAi.crate.filters.allowFullyAi).toBe(true);
    });
  });

  describe("verified humans", () => {
    it("verifiedHumanOnly keeps only verified-human artists", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW, verifiedHumanOnly: true },
      });
      expect(new Set(fixtureIds(response))).toEqual(new Set([id("t1"), id("t3")]));
      expect(response.crate.items.every((item) => item.verifiedHuman)).toBe(true);
    });

    it("marks verified-human artists on every line without the filter", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW },
      });
      const byId = new Map(response.crate.items.map((item) => [item.trackId, item]));
      expect(byId.get(id("t1"))?.verifiedHuman).toBe(true);
      expect(byId.get(id("t2"))?.verifiedHuman).toBe(false);
    });
  });

  describe("licenses and prices (filters, not ranking inputs)", () => {
    it("a license filter keeps tracks that list or price the tier and reports indicative prices", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW, licenseType: "remix" },
      });
      // t1, t2 are priced; t3 has an active remix listing. t2's expired
      // commercial listing is irrelevant here.
      expect(new Set(fixtureIds(response))).toEqual(new Set([id("t1"), id("t2"), id("t3")]));

      const byId = new Map(response.crate.items.map((item) => [item.trackId, item]));
      expect(byId.get(id("t1"))).toMatchObject({
        indicativePriceUsd: { personal: 0.05, remix: 8, commercial: 20 },
        linePriceUsd: 8,
        listedLicenseTypes: [],
      });
      expect(byId.get(id("t2"))).toMatchObject({
        indicativePriceUsd: { personal: 0.1, remix: 12, commercial: 30 },
        linePriceUsd: 12,
        // The expired listing does not count.
        listedLicenseTypes: [],
      });
      expect(byId.get(id("t3"))).toMatchObject({
        linePriceUsd: null,
        listedLicenseTypes: ["remix"],
      });
      expect(byId.get(id("t3"))?.indicativePriceUsd).toEqual({});
    });

    it("a per-item budget drops lines that cannot be shown to fit", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW, licenseType: "remix", maxPerItemUsd: 10 },
      });
      // t2 costs 12 and t3 has no known price.
      expect(fixtureIds(response)).toEqual([id("t1")]);
      expect(response.coverage.gaps.map((gap) => gap.filter)).toContain("maxPerItemUsd");
    });

    it("a total budget stops the crate at the budget and records the gap", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW, licenseType: "remix", maxTotalUsd: 10 },
      });
      const total = response.crate.items.reduce((sum, item) => sum + (item.linePriceUsd ?? 0), 0);
      expect(total).toBeLessThanOrEqual(10);
      expect(fixtureIds(response)).toEqual([id("t1")]);
      expect(response.coverage.gaps.map((gap) => gap.filter)).toContain("maxTotalUsd");
    });
  });

  describe("ordering", () => {
    it("orders lines as a set path with transitions to the next line", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 3, bpm: BPM_WINDOW, keys: ["8A"], includeCamelotNeighbors: true },
      });
      const { items } = response.crate;
      expect(items.length).toBeGreaterThanOrEqual(2);
      items.forEach((item, index) => {
        if (index === items.length - 1) expect(item.transitionToNext).toBeNull();
        else expect(item.transitionToNext).not.toBeNull();
      });
      // Deterministic: the same request builds the same order.
      const again = await service.createFromRequest(DJ, {
        filters: { count: 3, bpm: BPM_WINDOW, keys: ["8A"], includeCamelotNeighbors: true },
      });
      expect(again.crate.items.map((item) => item.trackId)).toEqual(
        items.map((item) => item.trackId),
      );
    });
  });

  describe("ranking taste", () => {
    it("still builds a crate when the taste profile cannot be resolved", async () => {
      const failing = new CratesService(
        deterministicCrateRequestParser,
        new DiscoveryRankingService(),
        new DiscoveryPolicyContextService(),
        new CrateEntitlementsService(),
        {
          resolveTasteProfile: jest.fn().mockRejectedValue(new Error("taste unavailable")),
        } as unknown as AgentLearningService,
      );
      const response = await failing.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW },
      });
      expect(new Set(fixtureIds(response))).toEqual(new Set([id("t1"), id("t2"), id("t3")]));
    });
  });

  describe("persistence and privacy", () => {
    it("CrateItem.userId is the crate owner and positions run 0..n-1", async () => {
      const response = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW },
      });
      const crate = await prisma.crate.findUniqueOrThrow({ where: { id: response.crate.id } });
      expect(crate).toMatchObject({ userId: DJ, status: "draft", title: null });

      const items = await prisma.crateItem.findMany({
        where: { crateId: response.crate.id },
        orderBy: { position: "asc" },
      });
      expect(items.length).toBe(response.crate.items.length);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.userId === DJ)).toBe(true);
      expect(items.map((item) => item.position)).toEqual(items.map((_, index) => index));
      expect(items.map((item) => item.trackId)).toEqual(
        response.crate.items.map((item) => item.trackId),
      );
    });

    it("never stores the request text or the unparsed phrases", async () => {
      const text = "techno 126 to 132 bpm in 8A zorblaxwhimsy";
      const response = await service.createFromRequest(DJ, { text });

      // Returned to the DJ in the response only.
      expect(response.request.unparsed.join(" ")).toContain("zorblaxwhimsy");

      const crate = await prisma.crate.findUniqueOrThrow({ where: { id: response.crate.id } });
      const request = await prisma.crateRequest.findUniqueOrThrow({
        where: { id: response.request.id },
      });
      expect(crate.title).toBeNull();
      expect(request.unparsedCount).toBeGreaterThanOrEqual(1);
      const stored = JSON.stringify([crate, request]);
      expect(stored).not.toContain("zorblaxwhimsy");
      expect(stored).not.toContain(text);
    });

    it("does not log the request text", async () => {
      const spies = (["log", "warn", "error", "debug", "verbose"] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation(() => {}),
      );
      try {
        await service.createFromRequest(DJ, { text: "techno 126 to 132 bpm zorblaxwhimsy" });
        const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
        expect(logged).not.toContain("zorblaxwhimsy");
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }
    });
  });

  describe("GET a crate", () => {
    it("returns the owner's crate with entitlements and no explanations", async () => {
      const created = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW },
      });
      const fetched = await service.getCrate(DJ, created.crate.id);

      expect(fetched.crate.id).toBe(created.crate.id);
      expect(fetched.crate.filters).toEqual(created.crate.filters);
      expect(fetched.crate.entitlements.pro.allowed).toBe(true);
      expect(fetched.crate.items.map((item) => item.trackId)).toEqual(
        created.crate.items.map((item) => item.trackId),
      );
      expect(fetched.crate.items.every((item) => item.available)).toBe(true);
      expect(fetched.crate.items.every((item) => item.explanation === undefined)).toBe(true);
      expect(fetched.crate.items.map((item) => item.transitionToNext)).toEqual(
        created.crate.items.map((item) => item.transitionToNext),
      );
    });

    it("another user's crate and an unknown id are both a 404", async () => {
      const created = await service.createFromRequest(DJ, {
        filters: { count: 5, bpm: BPM_WINDOW },
      });
      await expect(service.getCrate(OTHER_DJ, created.crate.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getCrate(DJ, id("no_such_crate"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("keeps a line whose track is no longer playable, marked unavailable", async () => {
      const created = await service.createFromRequest(DJ, {
        filters: { count: 25, bpm: BPM_WINDOW, keys: ["8A"], includeCamelotNeighbors: false },
      });
      expect(fixtureIds(created)).toContain(id("t2"));

      await prisma.release.update({
        where: { id: id("t2_release") },
        data: { status: "withdrawn", withdrawnAt: new Date() },
      });
      try {
        const fetched = await service.getCrate(DJ, created.crate.id);
        expect(fetched.crate.items.length).toBe(created.crate.items.length);
        const t2 = fetched.crate.items.find((item) => item.trackId === id("t2"));
        expect(t2).toBeDefined();
        expect(t2?.available).toBe(false);
        const t1 = fetched.crate.items.find((item) => item.trackId === id("t1"));
        expect(t1?.available).toBe(true);

        // A new crate no longer offers it.
        const fresh = await service.createFromRequest(DJ, {
          filters: { count: 25, bpm: BPM_WINDOW, keys: ["8A"], includeCamelotNeighbors: false },
        });
        expect(fixtureIds(fresh)).not.toContain(id("t2"));
      } finally {
        await prisma.release.update({
          where: { id: id("t2_release") },
          data: { status: "published", withdrawnAt: null },
        });
      }
    });
  });

  describe("line enrichment (#1963)", () => {
    const filters = { count: 25, bpm: BPM_WINDOW };

    it("returns the original stem id, rated stems and license options on every line", async () => {
      const created = await service.createFromRequest(DJ, { filters });
      const fetched = await service.getCrate(DJ, created.crate.id);

      for (const response of [created, fetched]) {
        const byId = new Map(response.crate.items.map((item) => [item.trackId, item]));

        const t1 = byId.get(id("t1"));
        expect(t1?.originalStemId).toBe(id("t1_original"));
        // The mean of 80 and 91, rounded; the original stem is never listed.
        expect(t1?.stems).toEqual([{ type: "drums", qualityScore: 86 }]);
        expect(t1?.licenseOptions).toEqual([
          {
            licenseType: "personal",
            listed: false,
            indicativePriceUsd: 0.05,
            standardTerms: true,
            grants: [...CRATE_LICENSE_RIGHTS.personal],
          },
          {
            licenseType: "remix",
            listed: false,
            indicativePriceUsd: 8,
            standardTerms: true,
            grants: [...CRATE_LICENSE_RIGHTS.remix],
          },
          {
            licenseType: "commercial",
            listed: false,
            indicativePriceUsd: 20,
            standardTerms: true,
            grants: [...CRATE_LICENSE_RIGHTS.commercial],
          },
        ]);

        // Unrated stem: null score. Expired commercial listing: not an option.
        const t2 = byId.get(id("t2"));
        expect(t2?.originalStemId).toBe(id("t2_original"));
        expect(t2?.stems).toEqual([{ type: "vocals", qualityScore: null }]);
        expect(t2?.licenseOptions.map((option) => option.licenseType)).toEqual([
          "personal",
          "remix",
          "commercial",
        ]);
        expect(t2?.licenseOptions.every((option) => !option.listed)).toBe(true);

        // Listed but unpriced tier: an option with a null price.
        const t3 = byId.get(id("t3"));
        expect(t3?.stems).toEqual([{ type: "bass", qualityScore: 70 }]);
        expect(t3?.licenseOptions).toEqual([
          {
            licenseType: "remix",
            listed: true,
            indicativePriceUsd: null,
            standardTerms: true,
            grants: [...CRATE_LICENSE_RIGHTS.remix],
          },
        ]);
        // Compatibility fields stay.
        expect(t3?.listedLicenseTypes).toEqual(["remix"]);
        expect(t3?.stemTypes).toEqual(["bass"]);
      }
    });
  });

  describe("list, edit and swap (#1963)", () => {
    const FILTERS = {
      count: 25,
      bpm: BPM_WINDOW,
      keys: ["8A"],
      includeCamelotNeighbors: true,
    };

    /**
     * A crate seeded directly for `EDITOR` with exactly `lines`, in order, so
     * the scenarios do not depend on what the ranker would pick.
     */
    async function freshCrate(
      overrides: Record<string, unknown> = FILTERS,
      lines = [id("t1"), id("t2"), id("t3")],
      owner = EDITOR,
    ) {
      const filters = { ...defaultCrateFilters(), ...overrides };
      const created = await prisma.crate.create({
        data: { userId: owner, title: null, status: "draft", filters: filters as never },
      });
      await prisma.crateItem.createMany({
        data: lines.map((trackId, position) => ({
          crateId: created.id,
          userId: owner,
          trackId,
          position,
        })),
      });
      const { crate } = await service.getCrate(owner, created.id);
      expect(crate.items.map((item) => item.trackId)).toEqual(lines);
      return crate;
    }

    const order = (crate: { items: Array<{ trackId: string }> }) =>
      crate.items.map((item) => item.trackId);

    async function errorBody(promise: Promise<unknown>) {
      const error = await promise.catch((caught) => caught);
      expect(error).toBeInstanceOf(Error);
      return {
        error,
        body: (error as { getResponse(): { code?: string } }).getResponse(),
      };
    }

    describe("GET /crates", () => {
      it("lists only the caller's own crates, newest update first, with item counts", async () => {
        const mine = await freshCrate();
        const theirs = (await freshCrate(FILTERS, [id("t1")], OTHER_DJ));
        const latest = await freshCrate(FILTERS, [id("t1")]);

        const { crates } = await service.listCrates(EDITOR);
        const ids = crates.map((crate) => crate.id);
        expect(ids).not.toContain(theirs.id);
        expect(ids).toContain(mine.id);
        expect(ids[0]).toBe(latest.id);

        const summary = crates.find((crate) => crate.id === mine.id);
        expect(summary).toEqual({
          id: mine.id,
          title: null,
          status: "draft",
          itemCount: 3,
          createdAt: mine.createdAt,
          updatedAt: expect.any(String),
        });
        expect(crates.find((crate) => crate.id === latest.id)?.itemCount).toBe(1);

        const updated = crates.map((crate) => Date.parse(crate.updatedAt));
        expect([...updated].sort((a, b) => b - a)).toEqual(updated);
        expect(crates.length).toBeLessThanOrEqual(50);

        const others = await service.listCrates(OTHER_DJ);
        expect(others.crates.map((crate) => crate.id)).toContain(theirs.id);
        expect(others.crates.map((crate) => crate.id)).not.toContain(mine.id);
      });

      it("a user with no crates gets an empty list", async () => {
        expect(await service.listCrates(id("nobody"))).toEqual({ crates: [] });
      });
    });

    describe("PATCH a crate", () => {
      it("reorders the lines and rewrites positions 0..n-1", async () => {
        const crate = await freshCrate();
        const reversed = [id("t3"), id("t2"), id("t1")];
        const response = await service.updateCrate(EDITOR, crate.id, {
          items: reversed.map((trackId) => ({ trackId })),
        });
        expect(order(response.crate)).toEqual(reversed);
        expect(response.crate.items.map((item) => item.position)).toEqual([0, 1, 2]);
        // Transitions follow the new order; the last line has none.
        expect(response.crate.items[2].transitionToNext).toBeNull();
        expect(response.crate.items[0].transitionToNext).not.toBeNull();

        const stored = await prisma.crateItem.findMany({
          where: { crateId: crate.id },
          orderBy: { position: "asc" },
        });
        expect(stored.map((item) => item.trackId)).toEqual(reversed);
        expect(stored.map((item) => item.position)).toEqual([0, 1, 2]);
        expect(stored.every((item) => item.userId === EDITOR)).toBe(true);

        expect(order((await service.getCrate(EDITOR, crate.id)).crate)).toEqual(reversed);
      });

      it("omitting a line removes it", async () => {
        const crate = await freshCrate();
        const response = await service.updateCrate(EDITOR, crate.id, {
          items: [{ trackId: id("t3") }, { trackId: id("t1") }],
        });
        expect(order(response.crate)).toEqual([id("t3"), id("t1")]);
        expect(response.crate.items.map((item) => item.position)).toEqual([0, 1]);
        expect(await prisma.crateItem.count({ where: { crateId: crate.id } })).toBe(2);

        const emptied = await service.updateCrate(EDITOR, crate.id, { items: [] });
        expect(emptied.crate.items).toEqual([]);
      });

      it("locks and unlocks lines; a missing locked keeps the current value", async () => {
        const crate = await freshCrate();
        const locked = await service.updateCrate(EDITOR, crate.id, {
          items: [{ trackId: id("t1"), locked: true }, { trackId: id("t2") }, { trackId: id("t3") }],
        });
        expect(locked.crate.items.map((item) => item.locked)).toEqual([true, false, false]);

        const reordered = await service.updateCrate(EDITOR, crate.id, {
          items: [{ trackId: id("t2") }, { trackId: id("t1") }, { trackId: id("t3") }],
        });
        expect(reordered.crate.items.map((item) => [item.trackId, item.locked])).toEqual([
          [id("t2"), false],
          [id("t1"), true],
          [id("t3"), false],
        ]);

        const unlocked = await service.updateCrate(EDITOR, crate.id, {
          items: [{ trackId: id("t2") }, { trackId: id("t1"), locked: false }, { trackId: id("t3") }],
        });
        expect(unlocked.crate.items.every((item) => !item.locked)).toBe(true);
      });

      it("sets, trims and clears the title", async () => {
        const crate = await freshCrate();
        const titled = await service.updateCrate(EDITOR, crate.id, { title: "  Friday set  " });
        expect(titled.crate.title).toBe("Friday set");
        // Not touching the title or the items leaves both alone.
        const same = await service.updateCrate(EDITOR, crate.id, { status: "draft" });
        expect(same.crate.title).toBe("Friday set");
        expect(order(same.crate)).toEqual(order(crate));

        expect((await service.updateCrate(EDITOR, crate.id, { title: "   " })).crate.title).toBeNull();
        await service.updateCrate(EDITOR, crate.id, { title: "again" });
        expect((await service.updateCrate(EDITOR, crate.id, { title: null })).crate.title).toBeNull();

        const stored = await prisma.crate.findUniqueOrThrow({ where: { id: crate.id } });
        expect(stored.title).toBeNull();
        const max = await service.updateCrate(EDITOR, crate.id, { title: "x".repeat(80) });
        expect(max.crate.title).toHaveLength(80);
      });

      it("saves a crate and moves it back to draft; the update bumps updatedAt", async () => {
        const crate = await freshCrate();
        const saved = await service.updateCrate(EDITOR, crate.id, { status: "saved" });
        expect(saved.crate.status).toBe("saved");
        expect(Date.parse(saved.crate.updatedAt)).toBeGreaterThanOrEqual(Date.parse(crate.updatedAt));
        expect(order(saved.crate)).toEqual(order(crate));

        const listed = (await service.listCrates(EDITOR)).crates.find((entry) => entry.id === crate.id);
        expect(listed?.status).toBe("saved");

        const draft = await service.updateCrate(EDITOR, crate.id, { status: "draft" });
        expect(draft.crate.status).toBe("draft");
      });

      it("never denies saving while the policy is free for everyone", async () => {
        // Past the free allowance of saved crates: still allowed today.
        for (let index = 0; index < 5; index += 1) {
          const crate = await freshCrate(FILTERS, [id("t1")]);
          const saved = await service.updateCrate(EDITOR, crate.id, { status: "saved" });
          expect(saved.crate.status).toBe("saved");
        }
      });

      it("rejects items that are not exactly the crate's lines with invalid_items", async () => {
        const crate = await freshCrate();
        const cases: Array<Array<{ trackId: string }>> = [
          // An unknown track.
          [{ trackId: id("t1") }, { trackId: id("does_not_exist") }],
          // A real track that is not a line of this crate: no additions.
          [{ trackId: id("t1") }, { trackId: id("t5") }],
          // A duplicate.
          [{ trackId: id("t1") }, { trackId: id("t1") }, { trackId: id("t2") }],
        ];
        for (const items of cases) {
          const { error, body } = await errorBody(service.updateCrate(EDITOR, crate.id, { items }));
          expect(error).toBeInstanceOf(BadRequestException);
          expect(body.code).toBe("invalid_items");
        }
        // Nothing was applied.
        expect(order((await service.getCrate(EDITOR, crate.id)).crate)).toEqual(order(crate));
      });

      it("another user's crate and an unknown id are a 404", async () => {
        const crate = await freshCrate();
        await expect(
          service.updateCrate(OTHER_DJ, crate.id, { title: "mine now" }),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.updateCrate(EDITOR, id("no_such_crate"), { title: "x" }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect((await service.getCrate(EDITOR, crate.id)).crate.title).toBeNull();
      });

      it("the enriched line DTO comes back from PATCH too", async () => {
        const crate = await freshCrate();
        const response = await service.updateCrate(EDITOR, crate.id, { title: "enriched" });
        const t1 = response.crate.items.find((item) => item.trackId === id("t1"));
        expect(t1?.originalStemId).toBe(id("t1_original"));
        expect(t1?.stems).toEqual([{ type: "drums", qualityScore: 86 }]);
        expect(t1?.licenseOptions.map((option) => option.licenseType)).toEqual([
          "personal",
          "remix",
          "commercial",
        ]);
      });
    });

    describe("swap a line", () => {
      it("replaces the line with a passing candidate not already in the crate, in place", async () => {
        // t1 (8A) and t3 (9A) are in the crate; t2 is the other passing track.
        const crate = await freshCrate(FILTERS, [id("t3"), id("t1")]);
        const response = await service.swapItem(EDITOR, crate.id, id("t1"));

        expect(response.swapped).toBe(true);
        const ids = order(response.crate);
        expect(ids).not.toContain(id("t1"));
        expect(ids[0]).toBe(id("t3"));
        // The replacement is a track that was not in the crate and passes the
        // crate's stored filters (t2: 8A, inside the BPM window).
        expect(ids[1]).toBe(id("t2"));
        expect(new Set(ids).size).toBe(ids.length);
        expect(response.crate.items.map((item) => item.position)).toEqual([0, 1]);
        expect(response.crate.items[1].locked).toBe(false);
        expect(response.crate.items[1].originalStemId).toBe(id("t2_original"));

        const stored = await prisma.crateItem.findMany({
          where: { crateId: crate.id },
          orderBy: { position: "asc" },
        });
        expect(stored.map((item) => [item.trackId, item.position, item.locked])).toEqual([
          [id("t3"), 0, false],
          [id("t2"), 1, false],
        ]);
        expect(stored.every((item) => item.userId === EDITOR)).toBe(true);

        // It persisted: a fresh read shows the same crate.
        expect(order((await service.getCrate(EDITOR, crate.id)).crate)).toEqual(ids);
      });

      it("never swaps in a track that fails the crate's filters", async () => {
        // Neighbours off: only 8A passes, so t3 (9A) is never a candidate, and
        // t4 (8A) is fully AI.
        const crate = await freshCrate({ ...FILTERS, includeCamelotNeighbors: false }, [
          id("t3"),
          id("t2"),
        ]);
        const response = await service.swapItem(EDITOR, crate.id, id("t3"));
        expect(response.swapped).toBe(true);
        expect(order(response.crate)).toEqual([id("t1"), id("t2")]);
      });

      it("a locked line is a 409 line_locked and nothing changes", async () => {
        const crate = await freshCrate(FILTERS, [id("t3"), id("t1")]);
        await service.updateCrate(EDITOR, crate.id, {
          items: [{ trackId: id("t3"), locked: true }, { trackId: id("t1") }],
        });
        const { error, body } = await errorBody(service.swapItem(EDITOR, crate.id, id("t3")));
        expect(error).toBeInstanceOf(ConflictException);
        expect(body.code).toBe("line_locked");
        expect(order((await service.getCrate(EDITOR, crate.id)).crate)).toEqual([id("t3"), id("t1")]);
      });

      it("a track that is not a line of the crate is a 404", async () => {
        const crate = await freshCrate(FILTERS, [id("t3"), id("t1")]);
        await expect(service.swapItem(EDITOR, crate.id, id("t2"))).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      it("another user's crate and an unknown id are a 404", async () => {
        const crate = await freshCrate(FILTERS, [id("t3"), id("t1")]);
        await expect(service.swapItem(OTHER_DJ, crate.id, id("t1"))).rejects.toBeInstanceOf(
          NotFoundException,
        );
        await expect(
          service.swapItem(EDITOR, id("no_such_crate"), id("t1")),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(order((await service.getCrate(EDITOR, crate.id)).crate)).toEqual([id("t3"), id("t1")]);
      });

      it("with no candidate left the crate is unchanged and swapped is false", async () => {
        // Every passing track is already in the crate.
        const crate = await freshCrate(FILTERS, [id("t1"), id("t2"), id("t3")]);
        const response = await service.swapItem(EDITOR, crate.id, id("t2"));
        expect(response.swapped).toBe(false);
        expect(order(response.crate)).toEqual([id("t1"), id("t2"), id("t3")]);
        const stored = await prisma.crateItem.findMany({
          where: { crateId: crate.id },
          orderBy: { position: "asc" },
        });
        expect(stored.map((item) => item.trackId)).toEqual([id("t1"), id("t2"), id("t3")]);
      });

      it("keeps the crate within maxTotalUsd; unknown prices do not fit", async () => {
        const budget = { count: 25, bpm: BPM_WINDOW, licenseType: "remix", maxTotalUsd: 10 };
        // t1 costs 8. The candidates are t2 (12, over budget) and t3 (no known
        // price), so nothing fits.
        const crate = await freshCrate(budget, [id("t1")]);
        const none = await service.swapItem(EDITOR, crate.id, id("t1"));
        expect(none.swapped).toBe(false);
        expect(order(none.crate)).toEqual([id("t1")]);

        // Alone in the crate, t2 (12) is over a 10 budget but fits a 15 one.
        const roomy = await freshCrate({ ...budget, maxTotalUsd: 15 }, [id("t1")]);
        const swapped = await service.swapItem(EDITOR, roomy.id, id("t1"));
        expect(swapped.swapped).toBe(true);
        expect(order(swapped.crate)).toEqual([id("t2")]);
      });

      it("counts the other lines against the budget", async () => {
        const budget = { count: 25, bpm: BPM_WINDOW, licenseType: "remix", maxTotalUsd: 15 };
        // t1 (8) stays; swapping t3 for t2 (12) would total 20 > 15.
        const over = await freshCrate(budget, [id("t1"), id("t3")]);
        const refused = await service.swapItem(EDITOR, over.id, id("t3"));
        expect(refused.swapped).toBe(false);
        expect(order(refused.crate)).toEqual([id("t1"), id("t3")]);

        // t2 (12) stays; t1 (8) fills the budget of 20 exactly.
        const exact = await freshCrate({ ...budget, maxTotalUsd: 20 }, [id("t3"), id("t2")]);
        const swapped = await service.swapItem(EDITOR, exact.id, id("t3"));
        expect(swapped.swapped).toBe(true);
        expect(order(swapped.crate)).toEqual([id("t1"), id("t2")]);
      });
    });
  });
});
