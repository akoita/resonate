import { prisma } from "../db/prisma";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

const PREFIX = `taste_v2_${Date.now()}_`;
const userId = `${PREFIX}listener`;
const artistId = `${PREFIX}artist`;
const releaseId = `${PREFIX}release`;
const trackId = `${PREFIX}track`;
const service = new TasteMemoryService(new EventBus());

describe("Taste Memory v2 summaries (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    await prisma.artist.create({ data: { id: artistId, userId, displayName: "Harbor Lights", payoutAddress: "0x" + "A".repeat(40) } });
    await prisma.release.create({ data: { id: releaseId, artistId, title: "Evening Colors", genre: "Soul", moods: ["Warm", "Late Night"], status: "published" } });
    await prisma.releaseArtistCredit.create({ data: { releaseId, artistId, role: "primary", displayName: "Harbor Lights Live", sortOrder: 0 } });
    await prisma.track.create({ data: { id: trackId, releaseId, title: "Colors", artist: "Incorrect fallback" } });
    await prisma.stem.create({ data: {
      id: `${PREFIX}original`, trackId, type: "original", uri: "test://full-mix", isCurrent: true,
      audioFeatures: { schemaVersion: "stem-audio-features/v1", extractor: { name: "librosa", version: "test" }, tempoBpm: 132, tempoConfidence: 0.9, energyRms: 0.15, onsetDensity: 2 },
    } });
  });

  beforeEach(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId } });
    await prisma.agentConfig.deleteMany({ where: { userId } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId } });
    await prisma.agentConfig.deleteMany({ where: { userId } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId } });
    await prisma.stem.deleteMany({ where: { trackId } });
    await prisma.track.delete({ where: { id: trackId } });
    await prisma.releaseArtistCredit.deleteMany({ where: { releaseId } });
    await prisma.release.delete({ where: { id: releaseId } });
    await prisma.artist.delete({ where: { id: artistId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function listen(createdAt = new Date()) {
    return prisma.agentSignal.create({ data: { userId, trackId, action: "complete", weight: 1.5, createdAt,
      metadata: { localHourBucket: "evening", weekdayKind: "weekday", mood: "Untrusted inferred mood", energy: "high" },
    } });
  }

  it("returns governed release, credit and measured-feature labels with coarse context only", async () => {
    await listen();
    const result = await service.getTasteMemory(userId);
    expect(result.summary).toMatchObject({
      favoredGenres: ["Soul"], favoredMoods: ["Late Night", "Warm"], favoredArtists: ["Harbor Lights Live"],
      favoredEnergyBands: ["medium"], favoredTempoBands: ["fast"],
      contexts: [{ localHourBucket: "evening", weekdayKind: "weekday", favoredGenres: ["Soul"], favoredMoods: ["Late Night", "Warm"] }],
    });
    const summary = JSON.stringify(result.summary);
    for (const privateValue of [userId, trackId, releaseId, "Untrusted inferred mood", "Incorrect fallback", "createdAt", "playbackInstanceId"]) {
      expect(summary).not.toContain(privateValue);
    }
  });

  it("does not resurrect stale persisted dimensions or count a stored profile twice", async () => {
    await listen();
    await prisma.agentConfig.create({ data: { userId, name: "Listener DJ", learnedTasteProfile: {
      schemaVersion: "agent-taste-profile/v1", genreWeights: { Phantom: 1000 }, favoredGenres: ["Phantom"],
    } } });
    const result = await service.getTasteMemory(userId);
    expect(result.summary.favoredGenres).toEqual(["Soul"]);
    expect(JSON.stringify(result.summary)).not.toContain("Phantom");
  });

  it("hides moods in global and context summaries and hides artists across all dimensions", async () => {
    await listen();
    await prisma.listenerTasteSignalControl.create({ data: { userId, signalType: "mood", value: "Warm", action: "hidden" } });
    let result = await service.getTasteMemory(userId);
    expect(result.summary.favoredMoods).toEqual(["Late Night"]);
    expect(result.summary.contexts[0].favoredMoods).toEqual(["Late Night"]);
    await prisma.listenerTasteSignalControl.create({ data: { userId, signalType: "artist", value: "Harbor Lights", action: "hidden" } });
    result = await service.getTasteMemory(userId);
    expect(result.summary.favoredGenres).toEqual([]);
    expect(result.summary.favoredMoods).toEqual([]);
    expect(result.summary.favoredArtists).toEqual([]);
    expect(result.summary.favoredEnergyBands).toEqual([]);
    expect(result.summary.favoredTempoBands).toEqual([]);
    expect(result.summary.contexts).toEqual([]);
  });

  it("reset clears every learned dimension and keeps declared controls", async () => {
    await listen(new Date(Date.now() - 60_000));
    await prisma.listenerTasteSignalControl.create({ data: { userId, signalType: "genre", value: "Jazz", action: "boosted", source: "declared_text_edit" } });
    await service.resetTasteMemory(userId);
    const result = await service.getTasteMemory(userId);
    for (const field of ["favoredGenres", "favoredMoods", "favoredArtists", "favoredEnergyBands", "favoredTempoBands", "contexts"] as const) {
      expect(result.summary[field]).toEqual([]);
    }
    expect(result.controls).toEqual(expect.arrayContaining([expect.objectContaining({ value: "Jazz", action: "boosted" })]));
  });

  it("ignores context outside bounded enums and history beyond the window", async () => {
    await listen(new Date(Date.now() - 731 * 24 * 60 * 60 * 1000));
    const old = await service.getTasteMemory(userId);
    expect(old.summary.favoredGenres).toEqual([]);
    await prisma.agentSignal.create({ data: { userId, trackId, action: "accept", weight: 1,
      metadata: { localHourBucket: "2026-10-03T21:30", weekdayKind: "Europe/Paris" },
    } });
    const current = await service.getTasteMemory(userId);
    expect(current.summary.favoredGenres).toEqual(["Soul"]);
    expect(current.summary.contexts).toEqual([]);
  });
  describe("declared taste drift (#2101)", () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const listenFiveTimes = async () => {
      for (let n = 0; n < 5; n += 1) await listen(new Date(Date.now() - n * 1000));
    };

    it("reports a boost older than 14 days that listening no longer supports", async () => {
      await listenFiveTimes();
      const control = await prisma.listenerTasteSignalControl.create({
        data: { userId, signalType: "genre", value: "Jazz", action: "boosted", source: "declared_text_edit", createdAt: daysAgo(20) },
      });
      const { summary } = await service.getTasteMemory(userId);
      expect(summary.tasteDrift).toEqual({
        staleBoosts: [{ controlId: control.id, signalType: "genre", value: "Jazz", boostedAt: control.createdAt.toISOString() }],
        listeningGenres: ["Soul"],
        listeningMoods: ["Late Night", "Warm"],
      });
    });

    it("stays silent for a fresh boost, a boost listening still supports, and thin evidence", async () => {
      await listenFiveTimes();
      await prisma.listenerTasteSignalControl.create({
        data: { userId, signalType: "genre", value: "Jazz", action: "boosted", createdAt: daysAgo(3) },
      });
      expect((await service.getTasteMemory(userId)).summary.tasteDrift).toBeNull();

      await prisma.listenerTasteSignalControl.deleteMany({ where: { userId } });
      await prisma.listenerTasteSignalControl.create({
        data: { userId, signalType: "genre", value: "soul", action: "boosted", createdAt: daysAgo(60) },
      });
      expect((await service.getTasteMemory(userId)).summary.tasteDrift).toBeNull();

      await prisma.agentSignal.deleteMany({ where: { userId } });
      await listen();
      await prisma.listenerTasteSignalControl.deleteMany({ where: { userId } });
      await prisma.listenerTasteSignalControl.create({
        data: { userId, signalType: "genre", value: "Jazz", action: "boosted", createdAt: daysAgo(60) },
      });
      expect((await service.getTasteMemory(userId)).summary.tasteDrift).toBeNull();
    });
  });
});
