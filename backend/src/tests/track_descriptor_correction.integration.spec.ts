/**
 * Artist corrections of generated descriptor tags (#2292) against real
 * Postgres (Testcontainers): the HTTP route through the real controller and
 * CatalogService (owner and credited manager allowed, everyone else 403,
 * vocabulary enforced), and what a correction must survive: a re-tag, a
 * metadata change, the backfill and a tagger write racing the correction. A
 * correction also re-embeds the track.
 */
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { ManagementGrantStatus, ManagementScope } from "@prisma/client";
import { prisma } from "../db/prisma";
import { CatalogController } from "../modules/catalog/catalog.controller";
import { CatalogService } from "../modules/catalog/catalog.service";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { EventBus } from "../modules/shared/event_bus";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { runBackfillTrackDescriptors } from "../scripts/backfill_track_descriptors";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const P = `desccorr_${Date.now()}_`;
const OWNER = `${P}owner`;
const MANAGER = `${P}manager`;
const MEDIA_MANAGER = `${P}media_manager`;
const OUTSIDER = `${P}outsider`;
const USER_IDS = [OWNER, MANAGER, MEDIA_MANAGER, OUTSIDER];
const ARTIST_ID = `${P}artist`;
const RELEASE_ID = `${P}release`;
const OTHER_RELEASE_ID = `${P}other_release`;
const TRACK_ID = `${P}track`;
const OTHER_TRACK_ID = `${P}other_track`;
const url = (trackId = TRACK_ID, releaseId = RELEASE_ID) =>
  `/catalog/releases/${releaseId}/tracks/${trackId}/descriptor`;

const silent = { warn: jest.fn(), info: jest.fn() };
const plainTagger = () => new TrackDescriptorTagger({ env: {}, logger: silent });
const stored = () => prisma.trackDescriptor.findUniqueOrThrow({ where: { trackId: TRACK_ID } });

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe("artist descriptor corrections (integration)", () => {
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;
  const bus = new EventBus();
  let app: INestApplication;
  let embeddings: TrackEmbeddingService;

  const put = (user: string | null, body: unknown, target = url()) => {
    const call = request(app.getHttpServer()).put(target);
    return (user ? call.set("Authorization", `Bearer ${authToken(user)}`) : call).send(body as object);
  };

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    await prisma.user.createMany({ data: USER_IDS.map((id) => ({ id, email: `${id}@test.resonate` })) });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: OWNER, displayName: "Fixture", payoutAddress: `0x${"e".repeat(40)}` },
    });
    await prisma.release.createMany({
      data: [RELEASE_ID, OTHER_RELEASE_ID].map((id) => ({
        id, artistId: ARTIST_ID, title: "Teranga Nights", primaryArtist: "Fixture", genre: "Senegal", status: "published",
      })),
    });
    await prisma.track.createMany({
      data: [
        { id: TRACK_ID, releaseId: RELEASE_ID },
        { id: OTHER_TRACK_ID, releaseId: OTHER_RELEASE_ID },
      ].map((t) => ({ ...t, title: "Teranga Nights", artist: "Fixture", position: 1 })),
    });
    const grant = (granteeUserId: string, scopes: ManagementScope[]) => ({
      granteeUserId, inviterUserId: OWNER, releaseId: RELEASE_ID, scopes,
      status: ManagementGrantStatus.active, acceptedAt: new Date(),
    });
    await prisma.managementGrant.createMany({
      data: [
        grant(MANAGER, [ManagementScope.TRACK_METADATA]),
        grant(MEDIA_MANAGER, [ManagementScope.CATALOG_MEDIA]),
      ],
    });

    const catalog = new CatalogService(bus, {} as never, {} as never, new UploadRightsRoutingService());
    app = await createControllerTestApp(CatalogController, [
      { provide: CatalogService, useValue: catalog },
      { provide: DiscoveryPopularityService, useValue: {} },
    ]);
    embeddings = new TrackEmbeddingService(new EmbeddingService(), new EmbeddingStore(), bus);
    embeddings.onModuleInit();
  });

  afterAll(async () => {
    embeddings.onModuleDestroy();
    bus.destroy();
    await app.close();
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: P } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } }).catch(() => {});
  });

  beforeEach(async () => {
    await prisma.trackDescriptor.deleteMany({ where: { trackId: { startsWith: P } } });
    silent.warn.mockClear();
  });

  it("the owner corrects families and sub-genres; the row is stored as artist-written and the bands stay measured", async () => {
    await prisma.trackDescriptor.create({
      data: {
        trackId: TRACK_ID, version: 1, families: ["african", "world"], subGenres: ["senegal"],
        tempoBand: "fast", energyBand: "high", vocal: "instrumental", source: "deterministic", contentHash: "generated",
      },
    });
    const res = await put(OWNER, { families: ["jazz"], subGenres: ["bossa nova"] }).expect(200);
    expect(res.body).toMatchObject({
      families: ["jazz"], familyLabels: ["Jazz"], subGenres: ["bossa nova"],
      tempoBand: "fast", energyBand: "high", vocal: "instrumental", source: "artist",
    });
    expect(await stored()).toMatchObject({
      families: ["jazz"], subGenres: ["bossa nova"], tempoBand: "fast", energyBand: "high",
      vocal: "instrumental", source: "artist", model: null,
    });
  });

  it("creates the descriptor of a track that was never tagged, and can clear every tag", async () => {
    await put(OWNER, { families: ["rock"], subGenres: [] }).expect(200);
    expect(await stored()).toMatchObject({ families: ["rock"], source: "artist", tempoBand: null });
    await put(OWNER, { families: [], subGenres: [] }).expect(200);
    expect(await stored()).toMatchObject({ families: [], subGenres: [], source: "artist" });
  });

  it("a credited manager with the track-metadata scope can correct", async () => {
    await put(MANAGER, { families: ["pop"], subGenres: [] }).expect(200);
    expect((await stored()).families).toEqual(["pop"]);
  });

  it("answers 401 without a token, and 403 to a manager without the scope and to an outsider", async () => {
    await put(null, { families: [], subGenres: [] }).expect(401);
    await put(MEDIA_MANAGER, { families: ["pop"], subGenres: [] }).expect(403);
    await put(OUTSIDER, { families: ["pop"], subGenres: [] }).expect(403);
    expect(await prisma.trackDescriptor.count({ where: { trackId: TRACK_ID } })).toBe(0);
  });

  it("answers 404 for a track that is not on the release, without writing", async () => {
    await put(OWNER, { families: ["pop"], subGenres: [] }, url(OTHER_TRACK_ID)).expect(404);
    expect(await prisma.trackDescriptor.count({ where: { trackId: { startsWith: P } } })).toBe(0);
  });

  it("answers 400 for tags outside the vocabulary and writes nothing", async () => {
    await put(OWNER, { families: ["not-a-family"], subGenres: [] }).expect(400);
    await put(OWNER, { families: [], subGenres: ["my own invented style"] }).expect(400);
    await put(OWNER, { families: [], subGenres: ["<img src=x onerror=alert(1)>"] }).expect(400);
    expect(await prisma.trackDescriptor.count({ where: { trackId: TRACK_ID } })).toBe(0);
  });

  it("keeps a generated free label the artist leaves in place, but cannot add a new free label", async () => {
    await prisma.trackDescriptor.create({
      data: { trackId: TRACK_ID, version: 1, families: ["world"], subGenres: ["sahel blues"], source: "model", contentHash: "generated" },
    });
    await put(OWNER, { families: ["world"], subGenres: ["sahel blues", "kora"] }).expect(200);
    expect((await stored()).subGenres).toEqual(["kora", "sahel blues"]);
    await put(OWNER, { families: ["world"], subGenres: ["desert blues"] }).expect(400);
    await put(OWNER, { families: ["world"], subGenres: [] }).expect(200);
    expect((await stored()).subGenres).toEqual([]);
  });

  it("survives a re-tag, a metadata change that changes the generated hash, and the backfill", async () => {
    await put(OWNER, { families: ["jazz"], subGenres: ["bossa nova"] }).expect(200);
    const corrected = await stored();

    const tagger = plainTagger();
    expect(await tagger.tagTracks([TRACK_ID], { apply: true })).toMatchObject({ skippedArtistOwned: 1, tagged: 0 });
    await prisma.release.update({ where: { id: RELEASE_ID }, data: { genre: "Techno" } });
    expect(await tagger.tagTracks([TRACK_ID], { apply: true })).toMatchObject({ skippedArtistOwned: 1, tagged: 0 });

    const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const report = await runBackfillTrackDescriptors(["--apply"], plainTagger());
      expect(report.skippedArtistOwned).toBeGreaterThanOrEqual(1);
    } finally {
      write.mockRestore();
      await prisma.release.update({ where: { id: RELEASE_ID }, data: { genre: "Senegal" } });
    }
    expect(await stored()).toMatchObject({
      families: ["jazz"], subGenres: ["bossa nova"], source: "artist", contentHash: corrected.contentHash,
    });
    expect((await stored()).updatedAt).toEqual(corrected.updatedAt);
  });

  it("a tagger that read the generated row before the correction landed does not overwrite it", async () => {
    await prisma.trackDescriptor.create({
      data: { trackId: TRACK_ID, version: 1, families: ["world"], subGenres: [], source: "deterministic", contentHash: "stale" },
    });
    // The tagger's snapshot: a generated row with a stale hash, so it will write.
    const snapshot = {
      id: TRACK_ID, title: "Teranga Nights", release: { genre: "Senegal", title: "Teranga Nights" }, stems: [],
      descriptor: { contentHash: "stale", source: "deterministic", updatedAt: new Date(0) },
    };
    await put(OWNER, { families: ["jazz"], subGenres: [] }).expect(200);
    const result = await plainTagger().tagRows([snapshot], { apply: true });
    expect(result).toMatchObject({ skippedArtistOwned: 1, tagged: 0, failed: 0 });
    expect(await stored()).toMatchObject({ families: ["jazz"], source: "artist" });

    // The same race when no row existed at read time: the create loses to the artist row.
    const racing = await plainTagger().tagRows([{ ...snapshot, descriptor: null }], { apply: true });
    expect(racing).toMatchObject({ skippedArtistOwned: 1, tagged: 0, failed: 0 });
    expect(await stored()).toMatchObject({ families: ["jazz"], source: "artist" });
  });

  it("re-embeds the track so the correction reaches retrieval", async () => {
    const service = new TrackEmbeddingService(new EmbeddingService(), new EmbeddingStore());
    await service.embedTracks([TRACK_ID]);
    const before = await prisma.trackEmbedding.findUniqueOrThrow({ where: { trackId: TRACK_ID } });

    await put(OWNER, { families: ["jazz"], subGenres: ["bossa nova"] }).expect(200);
    expect(
      await waitFor(async () => {
        const row = await prisma.trackEmbedding.findUnique({ where: { trackId: TRACK_ID } });
        return !!row && row.contentHash !== before.contentHash;
      }),
    ).toBe(true);
  });
});
