import { prisma } from "../db/prisma";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";
import { getListeningLaneSummary, resolveListeningLanes } from "../modules/agents/listening_lanes.service";
import * as computation from "../modules/agents/listening_lanes";
import { matchingMyMixLaneIds, resolveMyMixPlan } from "../modules/agents/agent_my_mix";
import { genreMatchesRequest } from "../modules/recommendations/genre_families";

const PREFIX = `lanes_${Date.now()}_`;
const userId = `${PREFIX}listener`;
const otherUserId = `${PREFIX}other`;
const artistId = `${PREFIX}artist`;
const service = new TasteMemoryService(new EventBus());
const genres = ["Soul", "Dancehall"];
const trackIds = genres.map((_, i) => `${PREFIX}track${i}`);
const releaseIds = genres.map((_, i) => `${PREFIX}release${i}`);
// Free-text catalog genres: none is in the taste-edit vocabulary (#2236).
const freeTextGenres = ["African", "Mandingue", "Highlife"];
const freeTextTrackIds = freeTextGenres.map((_, i) => `${PREFIX}ft_track${i}`);
const freeTextReleaseIds = freeTextGenres.map((_, i) => `${PREFIX}ft_release${i}`);
// A genre no vocabulary or family names (#2270 unknown_genres).
const unknownTrackId = `${PREFIX}unknown_track`;
const unknownReleaseId = `${PREFIX}unknown_release`;

async function seedHabits() {
  const createdAt = new Date(Date.now() - 60_000);
  for (let genre = 0; genre < 2; genre++) {
    for (let session = 0; session < 2; session++) {
      await prisma.agentSignal.create({ data: {
        userId, trackId: trackIds[genre], action: "save", weight: 3, createdAt,
        metadata: { playbackSessionId: `playback_${String(genre * 2 + session + 1).padStart(32, "0")}`,
          localHourBucket: genre === 0 ? "evening" : "night", weekdayKind: genre === 0 ? "weekday" : "weekend" },
      } });
    }
  }
}

describe("Listening lanes lifecycle (real DB)", () => {
  beforeAll(async () => {
    for (const id of [userId, otherUserId]) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    await prisma.artist.create({ data: { id: artistId, userId, displayName: "Lane Artist", payoutAddress: "0x" + "A".repeat(40) } });
    for (let i = 0; i < 2; i++) {
      await prisma.release.create({ data: { id: releaseIds[i], artistId, title: genres[i], genre: genres[i], moods: [i === 0 ? "Warm" : "Club"], status: "published" } });
      await prisma.track.create({ data: { id: trackIds[i], releaseId: releaseIds[i], title: `Track ${i}`, artist: "Lane Artist" } });
    }
  });
  beforeAll(async () => {
    for (let i = 0; i < freeTextGenres.length; i++) {
      await prisma.release.create({ data: { id: freeTextReleaseIds[i], artistId, title: freeTextGenres[i], genre: freeTextGenres[i], status: "published" } });
      await prisma.track.create({ data: { id: freeTextTrackIds[i], releaseId: freeTextReleaseIds[i], title: `Free text ${i}`, artist: "Lane Artist" } });
    }
  });
  beforeAll(async () => {
    await prisma.release.create({ data: { id: unknownReleaseId, artistId, title: "Unknown", genre: "Senegal", status: "published" } });
    await prisma.track.create({ data: { id: unknownTrackId, releaseId: unknownReleaseId, title: "Unknown genre", artist: "Lane Artist" } });
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await prisma.agentSignal.deleteMany({ where: { userId } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.agentSignal.deleteMany({ where: { userId } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.track.deleteMany({ where: { id: { in: [...trackIds, ...freeTextTrackIds, unknownTrackId] } } });
    await prisma.release.deleteMany({ where: { id: { in: [...releaseIds, ...freeTextReleaseIds, unknownReleaseId] } } });
    await prisma.artist.delete({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("returns two governed lanes, caches by profile version, and never reveals raw history", async () => {
    await seedHabits();
    const now = new Date();
    const compute = jest.spyOn(computation, "analyzeListeningLanes");
    const lanes = await getListeningLaneSummary(userId, { now });
    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => Object.keys(lane.genreWeights)[0]).sort()).toEqual(genres.slice().sort());
    expect(await getListeningLaneSummary(userId, { now })).toEqual(lanes);
    expect(compute).toHaveBeenCalledTimes(1);
    // A consumer cannot corrupt the cached result.
    lanes[0].label = "Mutated";
    expect((await getListeningLaneSummary(userId, { now }))[0].label).not.toBe("Mutated");
    const summary = JSON.stringify((await service.getTasteMemory(userId)).summary.listeningLanes);
    for (const value of [userId, ...trackIds, "playback_", "createdAt", "sessionKey", "Lane Artist"]) expect(summary).not.toContain(value);
    await getListeningLaneSummary(userId, { now: new Date(now.getTime() + 3_600_000) });
    expect(compute).toHaveBeenCalledTimes(2);
    await prisma.agentSignal.deleteMany({ where: { userId } });
    expect(await getListeningLaneSummary(userId, { now: new Date(now.getTime() + 3_600_000) })).toEqual([]);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("hides from mix consumers, restores by owned control, and rejects another listener's lane", async () => {
    await seedHabits();
    const lane = (await resolveListeningLanes(userId))[0];
    await expect(service.upsertSignalControl(otherUserId, { signalType: "lane", value: lane.id })).rejects.toThrow("Listening lane not found");
    const control = await service.upsertSignalControl(userId, { signalType: "lane", value: lane.id, action: "hidden" });
    expect(await resolveListeningLanes(userId)).toHaveLength(1);
    expect((await service.getTasteMemory(userId)).summary.listeningLanes).toEqual(expect.arrayContaining([expect.objectContaining({ id: lane.id, hidden: true })]));
    await expect(service.removeSignalControl(otherUserId, control.id)).rejects.toThrow("Taste signal control not found");
    await service.removeSignalControl(userId, control.id);
    expect(await resolveListeningLanes(userId)).toHaveLength(2);
    await expect(service.upsertSignalControl(userId, { signalType: "lane", value: lane.id, action: "downranked" })).rejects.toThrow();
    await expect(service.upsertSignalControl(userId, { signalType: "lane", value: "Soul" })).rejects.toThrow();
    await expect(service.upsertSignalControl(userId, { signalType: "lane", value: lane.id, action: "garbage" })).rejects.toThrow();
  });

  it("rebuilds after genre/mood/artist edits and catalog changes", async () => {
    await seedHabits();
    await getListeningLaneSummary(userId);
    const mood = await service.upsertSignalControl(userId, { signalType: "mood", value: "Warm" });
    expect((await resolveListeningLanes(userId)).find((lane) => lane.genreWeights.Soul)?.moodWeights).toEqual({});
    await service.removeSignalControl(userId, mood.id);
    const genre = await service.upsertSignalControl(userId, { signalType: "genre", value: "Soul" });
    expect(await resolveListeningLanes(userId)).toHaveLength(1);
    await service.removeSignalControl(userId, genre.id);
    await prisma.release.update({ where: { id: releaseIds[0] }, data: { moods: ["Zen"] } });
    expect((await resolveListeningLanes(userId)).find((lane) => lane.genreWeights.Soul)?.moodWeights).toHaveProperty("Zen");
    await prisma.release.update({ where: { id: releaseIds[0] }, data: { moods: ["Warm"] } });
    await service.upsertSignalControl(userId, { signalType: "artist", value: "Lane Artist" });
    expect(await resolveListeningLanes(userId)).toEqual([]);
  });

  it("requires repeated sessions and keeps the single profile available as fallback", async () => {
    await prisma.agentSignal.create({ data: { userId, trackId: trackIds[0], action: "purchase", weight: 5,
      metadata: { playbackSessionId: `playback_${"a".repeat(32)}`, localHourBucket: "evening", weekdayKind: "weekday" } } });
    expect(await resolveListeningLanes(userId)).toEqual([]);
    const memory = await service.getTasteMemory(userId);
    expect(memory.summary.favoredGenres).toEqual(["Soul"]);
    expect(memory.summary.listeningLanes).toEqual([]);
    expect(await resolveListeningLanes(otherUserId)).toEqual([]);
  });

  it("reset clears lanes and lane hides while preserving declared preferences", async () => {
    await seedHabits();
    const lane = (await resolveListeningLanes(userId))[0];
    await service.upsertSignalControl(userId, { signalType: "lane", value: lane.id });
    await prisma.listenerTasteSignalControl.create({ data: { userId, signalType: "genre", value: "Jazz", action: "boosted", source: "declared_text_edit" } });
    await service.resetTasteMemory(userId);
    expect(await resolveListeningLanes(userId)).toEqual([]);
    const memory = await service.getTasteMemory(userId);
    expect(memory.summary.listeningLanes).toEqual([]);
    expect(memory.controls.map((control) => control.signalType)).not.toContain("lane");
    expect(memory.controls).toEqual(expect.arrayContaining([expect.objectContaining({ value: "Jazz", action: "boosted" })]));
  });

  it("forms a lane from a free-text-genre history, and that lane claims the same tracks a World session matches (#2236)", async () => {
    // Three free-text genres, two browser sessions each. Before #2236 none is in
    // the taste-edit vocabulary, so the history produced no lane and no My Mix.
    const createdAt = new Date(Date.now() - 60_000);
    let session = 0;
    for (const trackId of freeTextTrackIds) {
      for (let repeat = 0; repeat < 2; repeat++) {
        session += 1;
        await prisma.agentSignal.create({ data: {
          userId, trackId, action: "save", weight: 3, createdAt,
          metadata: { playbackSessionId: `playback_${String(1000 + session).padStart(32, "0")}`,
            localHourBucket: "evening", weekdayKind: "weekday" },
        } });
      }
    }

    const lanes = await resolveListeningLanes(userId);
    expect(lanes).toHaveLength(1);
    expect(Object.keys(lanes[0].genreWeights)).toEqual(["african"]);
    expect(lanes[0].label).toBe("African");

    // The listener-facing summary carries the same lane, so My Mix is offered.
    const summary = (await service.getTasteMemory(userId)).summary.listeningLanes;
    expect(summary).toEqual([expect.objectContaining({ id: lanes[0].id, hidden: false, label: "African" })]);

    // A track that matches a "World" session matches the lane, whatever its label.
    const plan = resolveMyMixPlan({}, lanes, 5)!;
    const releases = await prisma.release.findMany({ where: { id: { in: freeTextReleaseIds } }, select: { genre: true } });
    expect(releases).toHaveLength(3);
    for (const { genre } of releases) {
      expect(genreMatchesRequest(genre, "World")).toBe(true);
      expect(matchingMyMixLaneIds(plan.lanes, { genre })).toEqual([lanes[0].id]);
    }

    // The new lane id is hide-able like any other.
    const control = await service.upsertSignalControl(userId, { signalType: "lane", value: lanes[0].id, action: "hidden" });
    expect(await resolveListeningLanes(userId)).toEqual([]);
    await service.removeSignalControl(userId, control.id);
    expect(await resolveListeningLanes(userId)).toHaveLength(1);
  });

  describe("Why a listener has no lanes (#2270, real DB)", () => {
    const reasonUser = `${PREFIX}reason`;
    const reasonService = new TasteMemoryService(new EventBus());

    const save = (trackId: string, session: number, ageDays = 0) =>
      prisma.agentSignal.create({ data: {
        userId: reasonUser, trackId, action: "save", weight: 3,
        createdAt: new Date(Date.now() - 60_000 - ageDays * 24 * 60 * 60 * 1000),
        metadata: { playbackSessionId: `playback_${String(5000 + session).padStart(32, "0")}`,
          localHourBucket: "evening", weekdayKind: "weekday" },
      } });
    const summary = async () => (await reasonService.getTasteMemory(reasonUser)).summary;

    beforeAll(async () => {
      await prisma.user.create({ data: { id: reasonUser, email: `${reasonUser}@test.resonate` } });
    });
    beforeEach(async () => {
      await prisma.agentSignal.deleteMany({ where: { userId: reasonUser } });
      await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: reasonUser } });
      await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: reasonUser } });
    });
    afterAll(async () => {
      await prisma.agentSignal.deleteMany({ where: { userId: reasonUser } });
      await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: reasonUser } });
      await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: reasonUser } });
      await prisma.user.delete({ where: { id: reasonUser } });
    });

    it("no_signals: a listener with no history, and again after a taste reset", async () => {
      expect(await summary()).toEqual(expect.objectContaining({ listeningLanes: [], listeningLanesEmptyReason: "no_signals" }));
      await save(trackIds[0], 1);
      await save(trackIds[0], 2);
      expect((await summary()).listeningLanesEmptyReason).toBeNull();
      await reasonService.resetTasteMemory(reasonUser);
      expect(await summary()).toEqual(expect.objectContaining({ listeningLanes: [], listeningLanesEmptyReason: "no_signals" }));
    });

    it("no_signals: signals with no playback session key", async () => {
      for (let i = 0; i < 3; i++) {
        await prisma.agentSignal.create({ data: { userId: reasonUser, trackId: trackIds[0], action: "save", weight: 3 } });
      }
      expect((await summary()).listeningLanesEmptyReason).toBe("no_signals");
    });

    it("unknown_genres: sessions whose genre no vocabulary or family names", async () => {
      await save(unknownTrackId, 1);
      await save(unknownTrackId, 2);
      expect(await summary()).toEqual(expect.objectContaining({ listeningLanes: [], listeningLanesEmptyReason: "unknown_genres" }));
    });

    it("too_few_sessions: a single session, however many signals", async () => {
      await save(trackIds[0], 1);
      await save(trackIds[0], 1);
      await save(trackIds[0], 1);
      expect(await summary()).toEqual(expect.objectContaining({ listeningLanes: [], listeningLanesEmptyReason: "too_few_sessions" }));
    });

    it("evidence_decayed: enough sessions, but the evidence has faded", async () => {
      await save(trackIds[0], 1, 500);
      await save(trackIds[0], 2, 500);
      expect(await summary()).toEqual(expect.objectContaining({ listeningLanes: [], listeningLanesEmptyReason: "evidence_decayed" }));
    });

    it("has no reason once a lane exists, even when the listener hides it", async () => {
      await save(trackIds[0], 1);
      await save(trackIds[0], 2);
      const lane = (await summary()).listeningLanes[0];
      expect(lane).toBeDefined();
      await reasonService.upsertSignalControl(reasonUser, { signalType: "lane", value: lane.id, action: "hidden" });
      const hidden = await summary();
      expect(hidden.listeningLanes).toEqual([expect.objectContaining({ id: lane.id, hidden: true })]);
      expect(hidden.listeningLanesEmptyReason).toBeNull();
    });

    it("stores a boosted family-keyed lane edit as the family label, so it reads well and matches members", async () => {
      await reasonService.applyTasteEdits(reasonUser, [
        { signalType: "genre", value: "ambient-lofi", action: "boosted" },
        { signalType: "genre", value: "Soul", action: "boosted" },
      ]);
      const values = (await reasonService.getTasteMemory(reasonUser)).controls
        .filter((control) => control.action === "boosted")
        .map((control) => control.value)
        .sort();
      expect(values).toEqual(["Ambient / Lo-fi", "Soul"]);
    });
  });
});
