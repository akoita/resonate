/**
 * Remix Export — Integration Test (Testcontainers) (#1307)
 *
 * Tests RemixProjectService.exportDraft against real Postgres: export requires
 * a COMMERCIAL license on the source stems (the tier that grants
 * export/download). Mirrors the publish integration setup but seeds a
 * commercial listing/purchase on one stem and a remix-only listing/purchase on
 * another, then asserts:
 *   - commercial-licensed stem → export 200 with sanitized download filename
 *     and the render bytes;
 *   - remix-only stem → 403 with code export_not_allowed and the eligibility
 *     payload (still remixable/publishable, just not exportable);
 *   - export-time eligibility re-check (a consent flip blocks export);
 *   - incomplete draft → 409 draft_not_completed;
 *   - non-owner → 403;
 *   - remix.exported event emission.
 *
 * Run: npm run test:integration
 */

import { ConflictException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import {
  RemixProjectService,
  type RemixDraftExport,
} from "../modules/remix/remix-project.service";
import { stubGenerationCredits } from "./e2e-helpers";
import { REMIX_POLICY_VERSION } from "../modules/remix/remix-eligibility.policy";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_PREFIX = `remix_export_${Date.now()}_`;

const CREATOR_ID = `${TEST_PREFIX}creator`;
const OTHER_USER_ID = `${TEST_PREFIX}other`;
const CREATOR_WALLET = `0x${"a7".repeat(20)}`;
const ARTIST_OWNER_ID = `${TEST_PREFIX}artist_owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const COMMERCIAL_STEM_ID = `${TEST_PREFIX}stem_commercial`;
const REMIX_ONLY_STEM_ID = `${TEST_PREFIX}stem_remix_only`;

const DRAFT_OUTPUT_URI = "local://remix-export-output.mp3";
const DRAFT_AUDIO = Buffer.from("exported remix audio bytes");

const storageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = { render: jest.fn() };


/** #2602: runs `fn` as if a watermark key were configured. */
async function withWatermarkKey<T>(fn: () => Promise<T>): Promise<T> {
  const before = {
    key: process.env.REMIX_WATERMARK_KEY,
    id: process.env.REMIX_WATERMARK_KEY_ID,
  };
  process.env.REMIX_WATERMARK_KEY = "key 00112233445566778899aabbccddeeff";
  process.env.REMIX_WATERMARK_KEY_ID = "test-key";
  try {
    return await fn();
  } finally {
    if (before.key === undefined) delete process.env.REMIX_WATERMARK_KEY;
    else process.env.REMIX_WATERMARK_KEY = before.key;
    if (before.id === undefined) delete process.env.REMIX_WATERMARK_KEY_ID;
    else process.env.REMIX_WATERMARK_KEY_ID = before.id;
  }
}
const EMBEDDED_MARK = {
  status: "embedded",
  scheme: "audiowmark",
  schemeVersion: "0.6.5",
  strength: 15,
  keyId: "test-key",
};

function completedGenerationMetadata(
  stemIds: string[],
  overrides: Record<string, unknown> = {},
) {
  return {
    status: "completed",
    mode: "stem_mix",
    grounding: "stem_audio",
    stemIds,
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
  stemId: string;
  generationMetadata?: Record<string, unknown> | null;
  title?: string;
  cues?: Record<string, unknown>;
}) {
  return prisma.remixProject.create({
    data: {
      creatorUserId: input.userId,
      sourceTrackId: TRACK_ID,
      title: input.title ?? "Exportable Remix / Take 1",
      mode: "stem_mix",
      policyVersion: REMIX_POLICY_VERSION,
      generationProvider: "stem-mix-render",
      ...(input.generationMetadata !== null
        ? {
            generationJobId: `rmxgen_${TEST_PREFIX}${input.stemId}`,
            generationMetadata: (input.generationMetadata ??
              completedGenerationMetadata([input.stemId])) as object,
          }
        : {}),
      stems: { create: [{ stemId: input.stemId }] },
      ...(input.cues ? { cues: input.cues as object } : {}),
    },
  });
}

const FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
// #2540: a 20 s draft at 120 BPM (a bar every 2 s from 0).
const DRAFT_GRID = {
  schemaVersion: "remix-draft-grid/v1",
  bpm: 120,
  downbeatsSec: Array.from({ length: 10 }, (_, i) => i * 2),
  timelineEndSec: 20,
};
const DJ_CUES = {
  schemaVersion: "remix-cues/v1",
  intro: { startBar: 0, bars: 2, repeats: 1 },
  outro: { startBar: 8, bars: 2, repeats: 2 },
};

/** Names of the entries in a stored ZIP, from its central directory. */
function zipEntryNames(zip: Buffer): string[] {
  const end = zip.length - 22;
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = zip.readUInt16LE(offset + 28);
    names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength;
  }
  return names;
}

async function seedListingAndPurchase(input: {
  stemId: string;
  tokenId: number;
  listingId: number;
  licenseType: "remix" | "commercial";
  suffix: string;
}) {
  const listing = await prisma.stemListing.create({
    data: {
      listingId: BigInt(input.listingId),
      stemId: input.stemId,
      tokenId: BigInt(input.tokenId),
      chainId: 31337,
      contractAddress: `0x${"c3".repeat(20)}`,
      sellerAddress: `0x${"e5".repeat(20)}`,
      pricePerUnit: "1000000",
      amount: BigInt(10),
      paymentToken: `0x${"0".repeat(40)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      transactionHash: `${TEST_PREFIX}list_${input.suffix}`,
      blockNumber: BigInt(200 + input.listingId),
      licenseType: input.licenseType,
      status: "active",
      listedAt: new Date(),
    },
  });
  await prisma.stemPurchase.create({
    data: {
      listingId: listing.id,
      buyerAddress: CREATOR_WALLET,
      amount: BigInt(1),
      totalPaid: "1000000",
      royaltyPaid: "0",
      protocolFeePaid: "0",
      sellerReceived: "1000000",
      licenseType: input.licenseType,
      transactionHash: `${TEST_PREFIX}buy_${input.suffix}`,
      blockNumber: BigInt(300 + input.listingId),
      purchasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // past the 14-day withdrawal period (#1776)
    },
  });
}

async function seedStem(stemId: string, tokenId: number, suffix: string) {
  await prisma.stem.create({
    data: {
      id: stemId,
      trackId: TRACK_ID,
      type: "vocals",
      uri: `local://source-stem-${suffix}`,
    },
  });
  await prisma.stemNftMint.create({
    data: {
      stemId,
      tokenId: BigInt(tokenId),
      chainId: 31337,
      contractAddress: `0x${"c3".repeat(20)}`,
      creatorAddress: `0x${"e5".repeat(20)}`,
      royaltyBps: 500,
      remixable: true,
      metadataUri: "ipfs://remixable",
      transactionHash: `${TEST_PREFIX}mint_${suffix}`,
      blockNumber: BigInt(100 + tokenId),
      mintedAt: new Date(),
    },
  });
}

describe("Remix export (integration)", () => {
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
        displayName: "Export Test Artist",
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
        artist: "Export Test Artist",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await seedStem(COMMERCIAL_STEM_ID, 9201, "commercial");
    await seedStem(REMIX_ONLY_STEM_ID, 9202, "remix_only");
    await seedListingAndPurchase({
      stemId: COMMERCIAL_STEM_ID,
      tokenId: 9201,
      listingId: 7201,
      licenseType: "commercial",
      suffix: "commercial",
    });
    await seedListingAndPurchase({
      stemId: REMIX_ONLY_STEM_ID,
      tokenId: 9202,
      listingId: 7202,
      licenseType: "remix",
      suffix: "remix_only",
    });
  });

  afterAll(async () => {
    await prisma.remixProject.deleteMany({
      where: { creatorUserId: { in: [CREATOR_ID, OTHER_USER_ID] } },
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
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
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
      stubGenerationCredits() as any,
    );
    storageProvider.download.mockReset();
    storageProvider.download.mockResolvedValue(DRAFT_AUDIO);
  });

  it("exports a completed draft when the source stem is commercial-licensed", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
    });

    const result = (await projectService.exportDraft(
      CREATOR_ID,
      project.id,
    )) as RemixDraftExport;

    expect(Buffer.from(result.data)).toEqual(DRAFT_AUDIO);
    expect(result.mimeType).toBe("audio/mpeg");
    // Title "Exportable Remix / Take 1" sanitizes to a safe .mp3 filename.
    expect(result.filename).toBe("Exportable-Remix-Take-1.mp3");

    const exportedEvent = publishSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.eventName === "remix.exported");
    expect(exportedEvent).toMatchObject({
      eventName: "remix.exported",
      remixProjectId: project.id,
      creatorId: CREATOR_ID,
      sourceTrackId: TRACK_ID,
      mode: "stem_mix",
      grounding: "stem_audio",
      aiGenerated: false,
      policyVersion: REMIX_POLICY_VERSION,
    });
  });

  it("refuses to export an AI draft that is not marked when a key is configured (#2602)", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
      generationMetadata: completedGenerationMetadata([COMMERCIAL_STEM_ID], {
        mode: "variation",
        grounding: "stem_plus_ai",
        renderMetadata: {
          schemaVersion: "remix-render/v1",
          watermark: { status: "none", reason: "embed_failed" },
        },
      }),
    });
    storageProvider.download.mockClear();
    publishSpy.mockClear();

    for (const variant of ["draft", "dj_extended", "stems"] as const) {
      const error = await withWatermarkKey(() =>
        projectService.exportDraft(CREATOR_ID, project.id, variant).then(
          () => null,
          (caught: { getStatus(): number; getResponse(): unknown }) => caught,
        ),
      );
      expect(error?.getStatus()).toBe(409);
      expect(error?.getResponse()).toMatchObject({ code: "draft_unmarked" });
    }
    // Refused before any audio is read or an export is recorded.
    expect(storageProvider.download).not.toHaveBeenCalled();
    expect(
      publishSpy.mock.calls.some(([event]) => event.eventName === "remix.exported"),
    ).toBe(false);
  });

  it("exports a marked AI draft, and an unmarked one where no key is configured (#2602)", async () => {
    const marked = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
      generationMetadata: completedGenerationMetadata([COMMERCIAL_STEM_ID], {
        mode: "variation",
        grounding: "stem_plus_ai",
        renderMetadata: { schemaVersion: "remix-render/v1", watermark: EMBEDDED_MARK },
      }),
    });
    const result = (await withWatermarkKey(() =>
      projectService.exportDraft(CREATOR_ID, marked.id),
    )) as RemixDraftExport;
    expect(Buffer.from(result.data)).toEqual(DRAFT_AUDIO);

    const unmarked = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
      generationMetadata: completedGenerationMetadata([COMMERCIAL_STEM_ID], {
        mode: "variation",
        grounding: "audio_conditioned",
      }),
    });
    const unkeyed = (await projectService.exportDraft(CREATOR_ID, unmarked.id)) as RemixDraftExport;
    expect(Buffer.from(unkeyed.data)).toEqual(DRAFT_AUDIO);
  });

  it("DJ extended (#2540): refuses without cues before reading any audio", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
      generationMetadata: completedGenerationMetadata([COMMERCIAL_STEM_ID], { draftGrid: DRAFT_GRID }),
    });
    const attempt = projectService.exportDraft(CREATOR_ID, project.id, "dj_extended");
    await expect(attempt).rejects.toThrow(ConflictException);
    await attempt.catch((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({ code: "dj_export_no_cues" });
    });
    expect(storageProvider.download).not.toHaveBeenCalled();
  });

  it("DJ extended (#2540): an older draft without a recorded grid asks for a new render", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
      cues: DJ_CUES,
    });
    const attempt = projectService.exportDraft(CREATOR_ID, project.id, "dj_extended");
    await expect(attempt).rejects.toThrow(ConflictException);
    await attempt.catch((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({ code: "dj_export_no_draft_grid" });
    });
  });

  it("DJ extended (#2540): still needs the commercial export right", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: REMIX_ONLY_STEM_ID,
      generationMetadata: completedGenerationMetadata([REMIX_ONLY_STEM_ID], { draftGrid: DRAFT_GRID }),
      cues: DJ_CUES,
    });
    await expect(
      projectService.exportDraft(CREATOR_ID, project.id, "dj_extended"),
    ).rejects.toThrow(ForbiddenException);
    expect(storageProvider.download).not.toHaveBeenCalled();
  });

  (FFMPEG ? it : it.skip)(
    "DJ extended (#2540): returns a zip with the extended MP3 and its cues sidecar",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "dj-export-it-"));
      try {
        const mp3Path = join(dir, "draft.mp3");
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=20:sample_rate=48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", mp3Path]);
        storageProvider.download.mockResolvedValue(readFileSync(mp3Path));
        const project = await createProjectRow({
          userId: CREATOR_ID,
          stemId: COMMERCIAL_STEM_ID,
          generationMetadata: completedGenerationMetadata([COMMERCIAL_STEM_ID], { draftGrid: DRAFT_GRID }),
          cues: DJ_CUES,
        });
        const result = (await projectService.exportDraft(
          CREATOR_ID,
          project.id,
          "dj_extended",
        )) as RemixDraftExport;
        expect(result.mimeType).toBe("application/zip");
        expect(result.filename).toBe("Exportable-Remix-Take-1-DJ-Extended.zip");
        expect(zipEntryNames(Buffer.from(result.data))).toEqual([
          "Exportable-Remix-Take-1-DJ-Extended.mp3",
          "Exportable-Remix-Take-1-DJ-Extended.cues.json",
        ]);
        const exportedEvent = publishSpy.mock.calls
          .map(([event]) => event)
          .find((event) => event.eventName === "remix.exported");
        expect(exportedEvent).toMatchObject({ variant: "dj_extended" });
        // #2602: the sidecar carries the AI disclosure (the zip is stored, so
        // the JSON is readable in place).
        const zipText = Buffer.from(result.data).toString("latin1");
        expect(zipText).toContain('"ai": {');
        expect(zipText).toContain('"aiGenerated": false');
        expect(zipText).toContain('"marking": "not_generated"');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("rejects export when the source stem is only remix-licensed", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: REMIX_ONLY_STEM_ID,
    });

    const error = await projectService
      .exportDraft(CREATOR_ID, project.id)
      .then(() => null)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    const response = error.getResponse() as {
      code: string;
      eligibility: { allowed: boolean; allowedActions: string[] };
    };
    expect(response.code).toBe("export_not_allowed");
    // Still allowed to remix/publish — just not export.
    expect(response.eligibility.allowed).toBe(true);
    expect(response.eligibility.allowedActions).toContain("publish_resonate");
    expect(response.eligibility.allowedActions).not.toContain("export");

    const exportedEvent = publishSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.eventName === "remix.exported");
    expect(exportedEvent).toBeUndefined();
  });

  it("re-checks eligibility at export time: a consent flip blocks export", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
    });
    await prisma.artist.update({
      where: { id: ARTIST_ID },
      data: { remixConsent: "disabled" },
    });

    try {
      const error = await projectService
        .exportDraft(CREATOR_ID, project.id)
        .then(() => null)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = error.getResponse() as { eligibility: any };
      expect(response.eligibility.allowed).toBe(false);
      expect(
        response.eligibility.reasons.map((reason: any) => reason.code),
      ).toContain("artist_remix_disabled");
    } finally {
      await prisma.artist.update({
        where: { id: ARTIST_ID },
        data: { remixConsent: "allowed" },
      });
    }
  });

  it("rejects export when no completed draft exists", async () => {
    const pending = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
      generationMetadata: completedGenerationMetadata([COMMERCIAL_STEM_ID], {
        status: "processing",
      }),
    });

    const error = await projectService
      .exportDraft(CREATOR_ID, pending.id)
      .then(() => null)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: "draft_not_completed" });
    expect(storageProvider.download).not.toHaveBeenCalled();
  });

  it("rejects export from non-owners", async () => {
    const project = await createProjectRow({
      userId: CREATOR_ID,
      stemId: COMMERCIAL_STEM_ID,
    });
    await expect(
      projectService.exportDraft(OTHER_USER_ID, project.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
