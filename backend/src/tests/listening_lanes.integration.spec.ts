import { prisma } from "../db/prisma";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";
import { getListeningLaneSummary, resolveListeningLanes } from "../modules/agents/listening_lanes.service";
import * as computation from "../modules/agents/listening_lanes";

const PREFIX = `lanes_${Date.now()}_`;
const userId = `${PREFIX}listener`;
const otherUserId = `${PREFIX}other`;
const artistId = `${PREFIX}artist`;
const service = new TasteMemoryService(new EventBus());
const genres = ["Soul", "Dancehall"];
const trackIds = genres.map((_, i) => `${PREFIX}track${i}`);
const releaseIds = genres.map((_, i) => `${PREFIX}release${i}`);

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
    await prisma.track.deleteMany({ where: { id: { in: trackIds } } });
    await prisma.release.deleteMany({ where: { id: { in: releaseIds } } });
    await prisma.artist.delete({ where: { id: artistId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("returns two governed lanes, caches by profile version, and never reveals raw history", async () => {
    await seedHabits();
    const now = new Date();
    const compute = jest.spyOn(computation, "computeListeningLanes");
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
});
