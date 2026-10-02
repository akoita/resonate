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

import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { CrateEntitlementsService } from "../modules/crates/crate-entitlements";
import { CRATE_REQUEST_MAX_TEXT_LENGTH } from "../modules/crates/crate.types";
import { defaultCrateFilters } from "../modules/crates/crate_filters";
import { deterministicCrateRequestParser } from "../modules/crates/crate_request_parser";
import { CratesService } from "../modules/crates/crates.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const TEST_PREFIX = `crates_${Date.now()}_`;
const DJ = `${TEST_PREFIX}dj`;
const OTHER_DJ = `${TEST_PREFIX}otherdj`;
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

    for (const userId of [DJ, OTHER_DJ, HUMAN_USER, PLAIN_USER]) {
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
});
