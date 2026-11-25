/**
 * Composition details per track (#2669), against real Postgres: who may read
 * and write them, copying across a release, the usage export, and that the
 * upload path stores them.
 */
import { prisma } from "../db/prisma";
import { CompositionService } from "../modules/composition/composition.service";

const TEST_PREFIX = `compo_${Date.now()}_`;
const artistUser = `${TEST_PREFIX}artist`;
const stranger = `${TEST_PREFIX}stranger`;
const artistId = `${TEST_PREFIX}artistprofile`;
const releaseId = `${TEST_PREFIX}rel`;
const draftReleaseId = `${TEST_PREFIX}draft`;
const trackIds = [1, 2, 3].map((n) => `${TEST_PREFIX}trk${n}`);
const draftTrackId = `${TEST_PREFIX}drafttrk`;

const writers = [
  { name: "Ada Lovelace", role: "composer", share: 60, society: "SACEM", ipi: "123456789" },
  { name: "=Grace Hopper", role: "lyricist", share: 40 },
];

describe("track composition (#2669)", () => {
  const service = new CompositionService();
  const eventIds: string[] = [];

  async function play(trackId: string, eventName: string, occurredAt: Date) {
    const eventId = `${TEST_PREFIX}ev${eventIds.length}`;
    eventIds.push(eventId);
    await prisma.analyticsEvent.create({
      data: {
        eventId,
        eventName,
        eventVersion: 1,
        occurredAt,
        receivedAt: occurredAt,
        producer: "test",
        environment: "test",
        privacyTier: "pseudonymous",
        subjectType: "track",
        subjectId: trackId,
        actorId: `${TEST_PREFIX}listener`,
        payload: {},
        envelope: {},
      },
    });
  }

  beforeAll(async () => {
    for (const id of [artistUser, stranger]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({ data: { id: artistId, userId: artistUser, displayName: `${TEST_PREFIX}Artist` } });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: "Composed Release",
        status: "published",
        tracks: { create: trackIds.map((id, i) => ({ id, title: `Song ${i + 1}`, position: i + 1, isrc: `FRXXX26000${i + 1}` })) },
      },
    });
    await prisma.release.create({
      data: {
        id: draftReleaseId,
        artistId,
        title: "Draft Release",
        status: "processing",
        tracks: { create: [{ id: draftTrackId, title: "Draft", position: 1 }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.trackComposition.deleteMany({ where: { trackId: { in: [...trackIds, draftTrackId] } } });
    await prisma.track.deleteMany({ where: { id: { in: [...trackIds, draftTrackId] } } });
    await prisma.release.deleteMany({ where: { id: { in: [releaseId, draftReleaseId] } } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("lets the artist save, refuses others, and removes on empty input", async () => {
    await expect(
      service.saveForTrack(releaseId, trackIds[0], stranger, { writers }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.saveForTrack(releaseId, trackIds[0], artistUser, { writers: [{ name: "A", role: "composer", share: 50 }] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.saveForTrack(releaseId, `${TEST_PREFIX}nope`, artistUser, { writers }),
    ).rejects.toMatchObject({ status: 404 });

    const saved = await service.saveForTrack(releaseId, trackIds[0], artistUser, {
      writers,
      publisher: "Analytical Songs",
      iswc: "T-034.524.680-1",
      coverOrSamples: true,
      coverNote: "Samples a field recording",
    });
    expect(saved.composition).toMatchObject({ iswc: "T0345246801", publisher: "Analytical Songs" });
    const row = await prisma.trackComposition.findUnique({ where: { trackId: trackIds[0] } });
    expect(row?.artistId).toBe(artistId);

    await service.saveForTrack(releaseId, trackIds[2], artistUser, { publisher: "Temp" });
    await expect(service.saveForTrack(releaseId, trackIds[2], artistUser, {})).resolves.toEqual({
      trackId: trackIds[2],
      composition: null,
    });
    await expect(prisma.trackComposition.count({ where: { trackId: trackIds[2] } })).resolves.toBe(0);
  });

  it("shows everything to the artist and operators, names and roles to everyone else", async () => {
    const full = await service.getForRelease(releaseId, { userId: artistUser });
    expect(full.access).toBe("full");
    expect(full.canEdit).toBe(true);
    const first = full.tracks[0] as { composition: { writers: unknown[] } | null };
    expect(first.composition?.writers).toHaveLength(2);

    const operator = await service.getForRelease(releaseId, { userId: stranger, role: "operator" });
    expect(operator).toMatchObject({ access: "full", canEdit: false });

    const publicView = await service.getForRelease(releaseId, {});
    expect(publicView.access).toBe("public");
    expect(publicView.tracks[0]).toEqual({
      trackId: trackIds[0],
      title: "Song 1",
      position: 1,
      writers: [
        { name: "Ada Lovelace", role: "composer" },
        { name: "=Grace Hopper", role: "lyricist" },
      ],
    });
    expect(JSON.stringify(publicView)).not.toContain("123456789");

    await expect(service.getForRelease(draftReleaseId, { userId: stranger })).rejects.toMatchObject({ status: 404 });
    await expect(service.getForRelease(draftReleaseId, { userId: artistUser })).resolves.toMatchObject({ access: "full" });
  });

  it("copies one track's details to the rest of the release, without the work code", async () => {
    await expect(service.copyToRelease(releaseId, trackIds[1], artistUser)).rejects.toMatchObject({ status: 400 });
    await expect(service.copyToRelease(releaseId, trackIds[0], stranger)).rejects.toMatchObject({ status: 403 });
    await expect(service.copyToRelease(releaseId, trackIds[0], artistUser)).resolves.toEqual({ copiedTo: 2 });
    const copies = await prisma.trackComposition.findMany({ where: { trackId: { in: trackIds.slice(1) } } });
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy).toMatchObject({ publisher: "Analytical Songs", iswc: null, coverOrSamples: true, artistId });
      expect(copy.writers).toEqual(writers);
    }
  });

  it("exports plays per track in the window with the composition fields", async () => {
    const inside = new Date("2026-11-10T12:00:00Z");
    await play(trackIds[0], "playback.started", inside);
    await play(trackIds[0], "playback.started", inside);
    await play(trackIds[0], "playback.completed", inside);
    await play(trackIds[1], "playback.started", inside);
    await play(trackIds[0], "playback.started", new Date("2026-10-01T00:00:00Z"));

    const report = await service.usageExport("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
    const lines = report.csv.trim().split("\r\n");
    expect(lines[0]).toContain("isrc,iswc");
    const first = lines.find((line) => line.includes(trackIds[0]));
    expect(first).toContain("FRXXX260001,T-034.524.680-1");
    expect(first).toContain("Ada Lovelace | composer | 60 | SACEM | 123456789; =Grace Hopper | lyricist | 40 |  | ");
    expect(first?.endsWith(",yes,2,1")).toBe(true);
    const second = lines.find((line) => line.includes(trackIds[1]));
    expect(second?.endsWith(",1,0")).toBe(true);
    expect(lines.some((line) => line.includes(trackIds[2]))).toBe(false);
  });

  it("refuses a bad window", async () => {
    await expect(service.usageExport("nope", undefined)).rejects.toMatchObject({ status: 400 });
    await expect(service.usageExport("2026-12-01", "2026-11-01")).rejects.toMatchObject({ status: 400 });
    await expect(service.usageExport("2025-01-01", "2026-12-01")).rejects.toMatchObject({ status: 400 });
  });
});
