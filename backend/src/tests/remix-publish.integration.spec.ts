/**
 * Remix Publish — Integration Test (Testcontainers) (#1196, E2)
 *
 * Tests RemixProjectService.publishProject against real Postgres: publish-time
 * eligibility re-checks (consent flips and quarantines block), the
 * publish_resonate action gate, completed-draft requirements, conditional-write
 * idempotency (double publish cannot create two releases), the created remix
 * release's lineage metadata, lifecycle locks on published projects, and
 * catalog streaming of the published track.
 *
 * Run: npm run test:integration
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { RemixProjectService } from "../modules/remix/remix-project.service";
import { REMIX_POLICY_VERSION } from "../modules/remix/remix-eligibility.policy";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";
import { CatalogService } from "../modules/catalog/catalog.service";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";

const TEST_PREFIX = `remix_publish_${Date.now()}_`;

const CREATOR_ID = `${TEST_PREFIX}creator`;
const OTHER_USER_ID = `${TEST_PREFIX}other`;
const ARTIST_OWNER_ID = `${TEST_PREFIX}artist_owner`;
const CREATOR_WALLET = `0x${"d4".repeat(20)}`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const LICENSED_STEM_ID = `${TEST_PREFIX}stem_licensed`;

const DRAFT_OUTPUT_URI = "local://remix-draft-output.mp3";
const DRAFT_AUDIO = Buffer.from("published remix audio bytes");

const storageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = { render: jest.fn() };

function newCatalog(): CatalogService {
  const configService = new ConfigService({
    ENCRYPTION_SECRET:
      process.env.ENCRYPTION_SECRET ||
      "test-encryption-secret-for-integration",
  });
  return new CatalogService(
    new EventBus(),
    new EncryptionService(
      new AesEncryptionProvider(configService) as any,
      configService,
    ) as any,
    new LocalStorageProvider(),
    new UploadRightsRoutingService(),
  );
}

function completedGenerationMetadata(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    mode: "stem_mix",
    grounding: "stem_audio",
    stemIds: [LICENSED_STEM_ID],
    policyVersion: REMIX_POLICY_VERSION,
    voiceLikenessAllowed: false,
    output: {
      outputUri: DRAFT_OUTPUT_URI,
      mimeType: "audio/mpeg",
      synthIdPresent: false,
      seed: null,
      sampleRate: 44100,
    },
    requestedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function createProjectRow(input: {
  userId: string;
  generationMetadata?: Record<string, unknown> | null;
  title?: string;
}) {
  return prisma.remixProject.create({
    data: {
      creatorUserId: input.userId,
      sourceTrackId: TRACK_ID,
      title: input.title ?? "Publishable Remix",
      mode: "stem_mix",
      policyVersion: REMIX_POLICY_VERSION,
      generationProvider: "stem-mix-render",
      ...(input.generationMetadata !== null
        ? {
            generationJobId: `rmxgen_${TEST_PREFIX}job`,
            generationMetadata: (input.generationMetadata ??
              completedGenerationMetadata()) as object,
          }
        : {}),
      stems: { create: [{ stemId: LICENSED_STEM_ID }] },
    },
  });
}

describe("Remix publish (integration)", () => {
  let projectService: RemixProjectService;
  let eventBus: EventBus;
  let publishSpy: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: CREATOR_ID, email: `${TEST_PREFIX}creator@test.resonate` },
        { id: OTHER_USER_ID, email: `${TEST_PREFIX}other@test.resonate` },
        {
          id: ARTIST_OWNER_ID,
          email: `${TEST_PREFIX}artist_owner@test.resonate`,
        },
      ],
    });
    await prisma.wallet.create({
      data: { userId: CREATOR_ID, address: CREATOR_WALLET, chainId: 31337 },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: ARTIST_OWNER_ID,
        displayName: "Publish Test Artist",
        payoutAddress: `0x${"e5".repeat(20)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Source Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: "Source Track",
        artist: "Publish Test Artist",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: {
        id: LICENSED_STEM_ID,
        trackId: TRACK_ID,
        type: "vocals",
        uri: "local://licensed-source-stem",
      },
    });
    await prisma.stemNftMint.create({
      data: {
        stemId: LICENSED_STEM_ID,
        tokenId: BigInt(9101),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        creatorAddress: `0x${"e5".repeat(20)}`,
        royaltyBps: 500,
        remixable: true,
        metadataUri: "ipfs://remixable",
        transactionHash: `${TEST_PREFIX}mint_licensed`,
        blockNumber: BigInt(200),
        mintedAt: new Date(),
      },
    });
    const remixListing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(7101),
        stemId: LICENSED_STEM_ID,
        tokenId: BigInt(9101),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"e5".repeat(20)}`,
        pricePerUnit: "1000000",
        amount: BigInt(10),
        paymentToken: `0x${"0".repeat(40)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        transactionHash: `${TEST_PREFIX}list_remix`,
        blockNumber: BigInt(201),
        licenseType: "remix",
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: remixListing.id,
        buyerAddress: CREATOR_WALLET,
        amount: BigInt(1),
        totalPaid: "1000000",
        royaltyPaid: "0",
        protocolFeePaid: "0",
        sellerReceived: "1000000",
        licenseType: "remix",
        transactionHash: `${TEST_PREFIX}buy_remix`,
        blockNumber: BigInt(202),
        purchasedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    const publishedReleases = await prisma.remixProject.findMany({
      where: {
        creatorUserId: { in: [CREATOR_ID, OTHER_USER_ID, ARTIST_OWNER_ID] },
        publishedReleaseId: { not: null },
      },
      select: { publishedReleaseId: true },
    });
    const publishedReleaseIds = publishedReleases
      .map((row) => row.publishedReleaseId)
      .filter((id): id is string => Boolean(id));
    await prisma.remixProject.deleteMany({
      where: {
        creatorUserId: { in: [CREATOR_ID, OTHER_USER_ID, ARTIST_OWNER_ID] },
      },
    });
    await prisma.stem.deleteMany({
      where: { track: { releaseId: { in: publishedReleaseIds } } },
    });
    await prisma.track.deleteMany({
      where: { releaseId: { in: publishedReleaseIds } },
    });
    await prisma.release.deleteMany({
      where: { id: { in: publishedReleaseIds } },
    });
    await prisma.stemPurchase.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemListing.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemNftMint.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    // Auto-created creator artist has a generated id; delete by user link.
    await prisma.artist.deleteMany({
      where: { userId: { in: [CREATOR_ID, ARTIST_OWNER_ID] } },
    });
    await prisma.wallet.deleteMany({ where: { userId: CREATOR_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [CREATOR_ID, OTHER_USER_ID, ARTIST_OWNER_ID] } },
    });
  });

  beforeEach(() => {
    eventBus = new EventBus();
    publishSpy = jest.spyOn(eventBus, "publish");
    projectService = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      new StubRemixGenerationProvider(),
      stemMixRenderer as any,
      storageProvider as any,
      generationQueue as any,
    );
    storageProvider.download.mockReset();
    storageProvider.upload.mockReset();
    storageProvider.download.mockResolvedValue(DRAFT_AUDIO);
    storageProvider.upload.mockImplementation(
      async (_data: Buffer, filename: string) => ({
        uri: `local://uploads/${filename}`,
        provider: "local",
      }),
    );
  });

  it("publishes a completed draft as a catalog remix release with lineage metadata", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });

    const result = await projectService.publishProject(CREATOR_ID, project.id);

    expect(result.status).toBe("published");
    expect(result.publishedReleaseId).toBeTruthy();
    expect(result.publishedRelease).toEqual({
      releaseId: result.publishedReleaseId,
      trackId: expect.any(String),
    });
    expect(result.attribution).toBe(
      'Remix of "Source Track" by Publish Test Artist',
    );

    const release = await prisma.release.findUniqueOrThrow({
      where: { id: result.publishedReleaseId! },
      include: { tracks: { include: { stems: true } }, artist: true },
    });
    expect(release.type).toBe("remix");
    expect(release.status).toBe("ready");
    expect(release.title).toBe("Publishable Remix");
    expect(release.rightsRoute).toBe("STANDARD_ESCROW");
    expect(release.rightsSourceType).toBe("remix_publish");
    // The creator had no artist profile; publish auto-creates one (same
    // pattern as the AI-generation flow).
    expect(release.artist.userId).toBe(CREATOR_ID);

    expect(release.tracks).toHaveLength(1);
    const track = release.tracks[0];
    const lineage = track.generationMetadata as Record<string, unknown>;
    expect(lineage).toMatchObject({
      kind: "remix_publish",
      remixProjectId: project.id,
      sourceTrackId: TRACK_ID,
      sourceReleaseId: RELEASE_ID,
      sourceStemIds: [LICENSED_STEM_ID],
      provider: "stem-mix-render",
      mode: "stem_mix",
      grounding: "stem_audio",
      // stem_audio renders contain the licensed source audio itself (#1164).
      aiGenerated: false,
      policyVersion: REMIX_POLICY_VERSION,
    });

    expect(track.stems).toHaveLength(1);
    const stem = track.stems[0];
    expect(stem.type).toBe("master");
    expect(stem.mimeType).toBe("audio/mpeg");
    expect(stem.storageProvider).toBe("local");
    expect(Buffer.from(stem.data!)).toEqual(DRAFT_AUDIO);
    // The published audio is a catalog-owned copy, not the draft's URI.
    expect(stem.uri).not.toBe(DRAFT_OUTPUT_URI);

    const publishedEvent = publishSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.eventName === "remix.published");
    expect(publishedEvent).toMatchObject({
      eventName: "remix.published",
      remixProjectId: project.id,
      creatorId: CREATOR_ID,
      sourceTrackId: TRACK_ID,
      // Cockpit attribution (#1121): source-track artist.
      artistId: ARTIST_ID,
      releaseId: release.id,
      trackId: track.id,
      mode: "stem_mix",
      grounding: "stem_audio",
      aiGenerated: false,
      creatorOwner: false,
      policyVersion: REMIX_POLICY_VERSION,
    });
  });

  it("marks AI-generated provenance for feature-conditioned drafts", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      generationMetadata: completedGenerationMetadata({
        mode: "variation",
        grounding: "feature_conditioned",
      }),
    });

    const result = await projectService.publishProject(CREATOR_ID, project.id);

    const track = await prisma.track.findFirstOrThrow({
      where: { releaseId: result.publishedReleaseId! },
    });
    expect(track.generationMetadata).toMatchObject({
      grounding: "feature_conditioned",
      aiGenerated: true,
    });
    const publishedEvent = publishSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.eventName === "remix.published");
    expect(publishedEvent).toMatchObject({ aiGenerated: true });
  });

  it("serves the published track through existing catalog streaming", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    const result = await projectService.publishProject(CREATOR_ID, project.id);

    const stream = await newCatalog().getTrackStream(
      result.publishedRelease.trackId,
    );
    expect(stream).not.toBeNull();
    expect(Buffer.from(stream!.data)).toEqual(DRAFT_AUDIO);
    expect(stream!.mimeType).toBe("audio/mpeg");
  });

  it("getRelease exposes the remix summary but strips the raw lineage blob (#1196 security)", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    const result = await projectService.publishProject(CREATOR_ID, project.id);

    const release = await newCatalog().getRelease(result.publishedReleaseId!);
    expect(release).not.toBeNull();
    expect(release!.remix).toMatchObject({
      attribution: 'Remix of "Source Track" by Publish Test Artist',
      sourceReleaseId: RELEASE_ID,
      grounding: "stem_audio",
      aiGenerated: false,
    });
    // The public read must not leak the raw generationMetadata blob (it can
    // hold generation cost, prompts, and seed for AI-generated tracks).
    for (const track of release!.tracks ?? []) {
      expect(track).not.toHaveProperty("generationMetadata");
    }
  });

  it("publishes under the existing artist profile for artist-owner remixes (#1174)", async () => {
    const project = await createProjectRow({ userId: ARTIST_OWNER_ID });

    const result = await projectService.publishProject(
      ARTIST_OWNER_ID,
      project.id,
    );

    const release = await prisma.release.findUniqueOrThrow({
      where: { id: result.publishedReleaseId! },
    });
    expect(release.artistId).toBe(ARTIST_ID);

    const publishedEvent = publishSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.eventName === "remix.published");
    expect(publishedEvent).toMatchObject({ creatorOwner: true });
  });

  it("rejects publish from non-owners", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    await expect(
      projectService.publishProject(OTHER_USER_ID, project.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects publish when no completed draft exists", async () => {
    const pending = await createProjectRow({
      userId: CREATOR_ID,
      generationMetadata: completedGenerationMetadata({
        status: "processing",
      }),
    });
    const never = await createProjectRow({
      userId: CREATOR_ID,
      generationMetadata: null,
    });

    for (const project of [pending, never]) {
      const error = await projectService
        .publishProject(CREATOR_ID, project.id)
        .then(() => null)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({
        code: "draft_not_completed",
      });
    }
    expect(storageProvider.upload).not.toHaveBeenCalled();
  });

  it("re-checks eligibility at publish time: a consent flip blocks publication", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    await prisma.artist.update({
      where: { id: ARTIST_ID },
      data: { remixConsent: "disabled" },
    });

    try {
      const error = await projectService
        .publishProject(CREATOR_ID, project.id)
        .then(() => null)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = error.getResponse() as { eligibility: any };
      expect(response.eligibility.allowed).toBe(false);
      expect(
        response.eligibility.reasons.map((reason: any) => reason.code),
      ).toContain("artist_remix_disabled");

      const rejection = publishSpy.mock.calls
        .map(([event]) => event)
        .find((event) => event.eventName === "remix.policy_rejected");
      expect(rejection).toMatchObject({
        reasonCodes: ["artist_remix_disabled"],
      });

      const reloaded = await prisma.remixProject.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(reloaded.status).toBe("draft");
      expect(reloaded.publishedReleaseId).toBeNull();
    } finally {
      await prisma.artist.update({
        where: { id: ARTIST_ID },
        data: { remixConsent: "allowed" },
      });
    }
  });

  it("re-checks eligibility at publish time: a quarantined source blocks publication", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    await prisma.track.update({
      where: { id: TRACK_ID },
      data: { contentStatus: "quarantined" },
    });

    try {
      const error = await projectService
        .publishProject(CREATOR_ID, project.id)
        .then(() => null)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = error.getResponse() as { eligibility: any };
      expect(
        response.eligibility.reasons.map((reason: any) => reason.code),
      ).toContain("source_quarantined");
    } finally {
      await prisma.track.update({
        where: { id: TRACK_ID },
        data: { contentStatus: "clean" },
      });
    }
  });

  it("cannot create two releases for the same project (sequential double publish)", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    const first = await projectService.publishProject(CREATOR_ID, project.id);

    const error = await projectService
      .publishProject(CREATOR_ID, project.id)
      .then(() => null)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: "already_published" });

    const releases = await prisma.release.findMany({
      where: { publishedRemixProject: { id: project.id } },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0].id).toBe(first.publishedReleaseId);
  });

  it("cannot create two releases for the same project (concurrent publish)", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });

    const outcomes = await Promise.allSettled([
      projectService.publishProject(CREATOR_ID, project.id),
      projectService.publishProject(CREATOR_ID, project.id),
    ]);

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);

    const releases = await prisma.release.findMany({
      where: { publishedRemixProject: { id: project.id } },
    });
    expect(releases).toHaveLength(1);
  });

  it("locks published projects against edits and generation but keeps reads working", async () => {
    const project = await createProjectRow({ userId: CREATOR_ID });
    await projectService.publishProject(CREATOR_ID, project.id);

    const patchError = await projectService
      .updateProject(CREATOR_ID, project.id, { title: "New title" })
      .then(() => null)
      .catch((caught) => caught);
    expect(patchError).toBeInstanceOf(ConflictException);
    expect(patchError.getResponse()).toMatchObject({
      code: "project_published",
    });

    await expect(
      projectService.generateDraft(CREATOR_ID, project.id, { retry: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const read = await projectService.getProject(CREATOR_ID, project.id);
    expect(read.status).toBe("published");
    expect(read.publishedReleaseId).toBeTruthy();
  });
});
