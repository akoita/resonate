/** Public deterministic Punchline Drops browse — integration (#1510). */

import { prisma } from "../db/prisma";
import { EncryptionService } from "../modules/encryption/encryption.service";
import {
  ListDropsOptions,
  PunchlineDropService,
} from "../modules/punchline/punchline-drop.service";
import { PunchlineClipService } from "../modules/punchline/punchline-clip.service";
import { PunchlineEligibilityService } from "../modules/punchline/punchline-eligibility.service";
import { PunchlineUnlockService } from "../modules/punchline/punchline-unlock.service";
import { EventBus } from "../modules/shared/event_bus";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";

const TEST_PREFIX = `punchline_browse_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}artist_user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const GENRE = `${TEST_PREFIX}Neo Soul`;

const eventBus = new EventBus();
const clipService = new PunchlineClipService(
  new LocalStorageProvider(),
  { decryptForRender: jest.fn() } as unknown as EncryptionService,
  undefined,
);
const service = new PunchlineDropService(
  eventBus,
  new PunchlineEligibilityService(),
  clipService,
  new PunchlineUnlockService(eventBus, clipService, undefined),
  undefined,
);

const defaults = (overrides: Partial<ListDropsOptions> = {}): ListDropsOptions => ({
  page: 1,
  limit: 48,
  kind: "all",
  genre: GENRE,
  price: "all",
  availability: "available",
  ...overrides,
});

let sequence = 0;
async function seedDrop(input: {
  suffix: string;
  status?: "draft" | "published" | "archived";
  publishedAt?: Date;
  genre?: string | null;
  moments?: Array<{ priceCents: number; editionSize: number; collected: number; recent?: boolean }>;
  artistId?: string;
  trackId?: string;
}) {
  const dropId = `${TEST_PREFIX}${input.suffix}`;
  const moments = input.moments ?? [{ priceCents: 0, editionSize: 10, collected: 0 }];
  await prisma.punchlineDrop.create({
    data: {
      id: dropId,
      trackId: input.trackId ?? TRACK_ID,
      artistId: input.artistId ?? ARTIST_ID,
      status: input.status ?? "published",
      publishedAt: input.status === "draft" ? null : (input.publishedAt ?? new Date()),
      title: `${input.suffix} title`,
      description: `${input.suffix} description`,
      moments: {
        create: moments.map((moment, index) => ({
          id: `${dropId}_m${index}`,
          title: `${input.suffix} moment ${index}`,
          lyricText: "a public lyric",
          artworkUrl: null,
          startMs: index * 5000,
          endMs: index * 5000 + 4000,
          editionSize: moment.editionSize,
          priceCents: moment.priceCents,
        })),
      },
    },
  });
  for (let momentIndex = 0; momentIndex < moments.length; momentIndex += 1) {
    const moment = moments[momentIndex];
    for (let edition = 1; edition <= moment.collected; edition += 1) {
      sequence += 1;
      const collectorId = `${TEST_PREFIX}fan_${sequence}`;
      await prisma.user.create({
        data: { id: collectorId, email: `${collectorId}@test.resonate` },
      });
      await prisma.punchlineCollectible.create({
        data: {
          id: `${TEST_PREFIX}collectible_${sequence}`,
          momentId: `${dropId}_m${momentIndex}`,
          collectorUserId: collectorId,
          editionNumber: edition,
          status: "owned",
          acquiredAt: moment.recent
            ? new Date(Date.now() - 60 * 60 * 1000)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  return dropId;
}

describe("Punchline public Drops browse (#1510)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@test.resonate` } });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: USER_ID, displayName: "Manager Name" },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Browse Release",
        status: "ready",
        genre: GENRE,
        primaryArtist: "Credited Browse Artist",
        artworkMimeType: "image/jpeg",
      },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "Browse Track", position: 1 },
    });
  });

  afterAll(async () => {
    await prisma.punchlineUnlock.deleteMany({
      where: { drop: { id: { startsWith: TEST_PREFIX } } },
    });
    await prisma.punchlineCollectible.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineMoment.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineDrop.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("defaults to published, nonempty, available drops and supports all/sold_out", async () => {
    const available = await seedDrop({ suffix: "visibility_available" });
    const soldOut = await seedDrop({
      suffix: "visibility_sold",
      moments: [{ priceCents: 0, editionSize: 2, collected: 2 }],
    });
    await seedDrop({ suffix: "visibility_draft", status: "draft" });
    const archived = await seedDrop({ suffix: "visibility_archived", status: "archived" });
    const empty = await seedDrop({ suffix: "visibility_empty", moments: [] });

    const defaultResult = await service.listDrops(defaults());
    const defaultIds = defaultResult.items.map((item) => item.id);
    expect(defaultIds).toContain(available);
    expect(defaultIds).not.toContain(soldOut);
    expect(defaultIds).not.toContain(empty);
    expect(defaultIds).not.toContain(archived);

    const all = await service.listDrops(defaults({ availability: "all" }));
    expect(all.items.map((item) => item.id)).toEqual(expect.arrayContaining([available, soldOut]));
    const sold = await service.listDrops(defaults({ availability: "sold_out" }));
    expect(sold.items.map((item) => item.id)).toContain(soldOut);
    expect(sold.items.map((item) => item.id)).not.toContain(available);
  });

  it("enforces price and availability on the same moment", async () => {
    const split = await seedDrop({
      suffix: "price_split",
      moments: [
        { priceCents: 0, editionSize: 1, collected: 1 },
        { priceCents: 100, editionSize: 2, collected: 1 },
      ],
    });
    const mixedAvailable = await seedDrop({
      suffix: "price_mixed_available",
      moments: [
        { priceCents: 0, editionSize: 2, collected: 0 },
        { priceCents: 100, editionSize: 2, collected: 0 },
      ],
    });

    const freeAvailable = await service.listDrops(defaults({ price: "free" }));
    expect(freeAvailable.items.map((item) => item.id)).not.toContain(split);
    expect(freeAvailable.items.map((item) => item.id)).toContain(mixedAvailable);
    const paidAvailable = await service.listDrops(defaults({ price: "paid" }));
    expect(paidAvailable.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([split, mixedAvailable]),
    );
    const freeAll = await service.listDrops(
      defaults({ price: "free", availability: "all" }),
    );
    expect(freeAll.items.map((item) => item.id)).toContain(split);
  });

  it("matches genre exactly, case-insensitively; blank genre is unfiltered", async () => {
    const match = await seedDrop({ suffix: "genre_exact" });
    const folded = await service.listDrops(
      defaults({ genre: `  ${GENRE.toLocaleUpperCase()}  `.trim() }),
    );
    expect(folded.items.map((item) => item.id)).toContain(match);
    const partial = await service.listDrops(defaults({ genre: GENRE.slice(0, -1) }));
    expect(partial.items.map((item) => item.id)).not.toContain(match);
    const unfiltered = await service.listDrops(defaults({ genre: undefined }));
    expect(unfiltered.items.map((item) => item.id)).toContain(match);
  });

  it.each(["all", "punchline"] as const)("kind=%s returns Punchline rows", async (kind) => {
    const id = await seedDrop({ suffix: `kind_${kind}` });
    const result = await service.listDrops(defaults({ kind }));
    expect(result.items.map((item) => item.id)).toContain(id);
  });

  it("uses the complete ranking chain, including ascending ID as final tie-break", async () => {
    const samePublishedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const recentTwo = await seedDrop({
      suffix: "rank_recent_two",
      publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      moments: [{ priceCents: 0, editionSize: 10, collected: 2, recent: true }],
    });
    const recentOne = await seedDrop({
      suffix: "rank_recent_one",
      moments: [
        { priceCents: 0, editionSize: 1, collected: 1, recent: true },
        { priceCents: 0, editionSize: 9, collected: 8 },
      ],
    });
    const scarce = await seedDrop({
      suffix: "rank_scarce",
      publishedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      moments: [{ priceCents: 0, editionSize: 10, collected: 8 }],
    });
    const newer = await seedDrop({
      suffix: "rank_newer",
      publishedAt: samePublishedAt,
      moments: [{ priceCents: 0, editionSize: 10, collected: 5 }],
    });
    const older = await seedDrop({
      suffix: "rank_older",
      publishedAt: new Date(samePublishedAt.getTime() - 24 * 60 * 60 * 1000),
      moments: [{ priceCents: 0, editionSize: 10, collected: 5 }],
    });
    const tieA = await seedDrop({
      suffix: "rank_tie_a",
      publishedAt: samePublishedAt,
      moments: [{ priceCents: 0, editionSize: 10, collected: 5 }],
    });

    const result = await service.listDrops(defaults());
    const ids = result.items.map((item) => item.id);
    expect(ids.indexOf(recentTwo)).toBeLessThan(ids.indexOf(recentOne));
    expect(ids.indexOf(recentOne)).toBeLessThan(ids.indexOf(scarce));
    expect(ids.indexOf(scarce)).toBeLessThan(ids.indexOf(newer));
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(tieA));
  });

  it("pages after ranking without duplicates/omissions, allows a third same-artist drop, and handles out-of-range", async () => {
    const pagingGenre = `${TEST_PREFIX}Paging`;
    const pagingReleaseId = `${TEST_PREFIX}paging_release`;
    const pagingTrackId = `${TEST_PREFIX}paging_track`;
    await prisma.release.create({
      data: {
        id: pagingReleaseId,
        artistId: ARTIST_ID,
        title: "Paging Release",
        status: "ready",
        genre: pagingGenre,
      },
    });
    await prisma.track.create({
      data: {
        id: pagingTrackId,
        releaseId: pagingReleaseId,
        title: "Paging Track",
        position: 1,
      },
    });
    const ids = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(
        await seedDrop({ suffix: `paging_${index}`, trackId: pagingTrackId }),
      );
    }
    const page1 = await service.listDrops(defaults({ genre: pagingGenre, page: 1, limit: 2 }));
    const page2 = await service.listDrops(defaults({ genre: pagingGenre, page: 2, limit: 2 }));
    const page3 = await service.listDrops(defaults({ genre: pagingGenre, page: 3, limit: 2 }));
    const browsed = [...page1.items, ...page2.items, ...page3.items].map((item) => item.id);
    expect(new Set(browsed).size).toBe(browsed.length);
    expect(browsed).toEqual(expect.arrayContaining(ids));
    expect(browsed).toHaveLength(5);
    expect(page1.meta).toMatchObject({ totalCount: 5, totalPages: 3, hasNextPage: true });
    expect(page3.meta).toMatchObject({ count: 1, hasNextPage: false });

    const outOfRange = await service.listDrops(defaults({ genre: pagingGenre, page: 9, limit: 2 }));
    expect(outOfRange.items).toEqual([]);
    expect(outOfRange.meta).toMatchObject({ count: 0, page: 9, totalCount: 5, totalPages: 3, hasNextPage: false });
  });

  it("serializes aggregate availability, context, honest meta/facets, and hides unlock rewards", async () => {
    const id = await seedDrop({
      suffix: "serialization",
      moments: [
        { priceCents: 0, editionSize: 4, collected: 1 },
        { priceCents: 100, editionSize: 6, collected: 2 },
      ],
    });
    await prisma.punchlineUnlock.create({
      data: {
        id: `${id}_unlock`,
        dropId: id,
        rewardMetadata: { note: "must remain private", startMs: 0, endMs: 1000 },
      },
    });
    const result = await service.listDrops(defaults());
    const item = result.items.find((candidate) => candidate.id === id)!;
    expect(item.kind).toBe("punchline");
    expect(item.availability).toEqual({
      soldOut: false,
      totalEditions: 10,
      collectedCount: 3,
      remainingEditions: 7,
    });
    expect(item.context).toEqual({
      trackTitle: "Browse Track",
      releaseId: RELEASE_ID,
      releaseTitle: "Browse Release",
      releaseHasArtwork: true,
      artistName: "Credited Browse Artist",
      genre: GENRE,
    });
    expect(item.unlock).toEqual({ unlockType: "complete_set" });
    expect((item.unlock as any).reward).toBeUndefined();
    expect(result.meta.count).toBe(result.items.length);
    expect(result.facets.genres).toContain(GENRE);
    // Paging candidates use another genre. It remains in facets even though
    // this query selected GENRE, proving facets are filter-independent.
    expect(result.facets.genres).toContain(`${TEST_PREFIX}Paging`);
    expect(new Set(result.facets.genres.map((genre) => genre.toLowerCase())).size).toBe(
      result.facets.genres.length,
    );
    expect(result.facets.genres).toEqual(
      [...result.facets.genres].sort((a, b) => {
        const foldedA = a.toLowerCase();
        const foldedB = b.toLowerCase();
        if (foldedA !== foldedB) return foldedA < foldedB ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      }),
    );
  });
});
