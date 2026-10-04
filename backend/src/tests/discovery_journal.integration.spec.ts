import { prisma } from "../db/prisma";
import { buildAgentSignalMetadata } from "../modules/agents/agent_learning.service";
import {
  DISCOVERY_JOURNAL_SCHEMA_VERSION,
  DiscoveryJournal,
  DiscoveryJournalItem,
  DiscoveryJournalService,
  NEW_RELEASES_LIMIT,
  PENDING_LIMIT,
  RESONANCE_FOLLOW_UP_DAYS,
} from "../modules/discovery_journal/discovery_journal.service";
import { DISCOVERY_EXPLANATIONS } from "../modules/recommendations/discovery-explanations";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `djournal_${Date.now()}_`;
const NOW = new Date("2026-06-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const L1 = `${TEST_PREFIX}listener1`;
const L2 = `${TEST_PREFIX}listener2`;
const L3 = `${TEST_PREFIX}listener3`;
const L4 = `${TEST_PREFIX}listener4`;
const L5 = `${TEST_PREFIX}listener5`; // only "almost there" tracks
const L6 = `${TEST_PREFIX}listener6`; // saves a pending track
const N1 = `${TEST_PREFIX}newrel1`; // "new from artists you discovered"
const N2 = `${TEST_PREFIX}newrel2`; // another listener with its own journal artist
const N3 = `${TEST_PREFIX}newrel3`; // no resonant tracks
const OWNER = `${TEST_PREFIX}verifiedowner`; // lowercase: matches the reputation wallet key

const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const days = (n: number) => n * 24;

type Seeded = { artistId: string; releaseId: string; trackId: string };

async function seedTrack(
  name: string,
  options: {
    artistId?: string;
    releaseStatus?: string;
    title?: string;
    genre?: string;
    createdAt?: Date;
    aiDisclosureLevel?: "UNDECLARED" | "NONE" | "PARTLY" | "ALL";
  } = {},
): Promise<Seeded> {
  const artistId = options.artistId ?? `${TEST_PREFIX}artist_${name}`;
  if (!options.artistId) {
    await prisma.artist.create({
      data: { id: artistId, displayName: `Account ${name}` },
    });
  }
  const releaseId = `${TEST_PREFIX}release_${name}`;
  await prisma.release.create({
    data: {
      id: releaseId,
      artistId,
      title: `Release ${name}`,
      genre: options.genre ?? "Deep House",
      status: options.releaseStatus ?? "published",
      primaryArtist: `Credited ${name}`,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  const trackId = `${TEST_PREFIX}track_${name}`;
  await prisma.track.create({
    data: {
      id: trackId,
      releaseId,
      title: options.title ?? `Track ${name}`,
      position: 1,
      ...(options.aiDisclosureLevel ? { aiDisclosureLevel: options.aiDisclosureLevel } : {}),
    },
  });
  return { artistId, releaseId, trackId };
}

async function signal(
  userId: string,
  trackId: string,
  action: "accept" | "complete" | "replay" | "save" | "add_to_playlist" | "skip",
  at: Date,
  extra: {
    ratio?: number;
    sessionId?: string;
    source?: string;
    recommendation?: unknown;
  } = {},
) {
  await prisma.agentSignal.create({
    data: {
      userId,
      trackId,
      action,
      weight: 1,
      sessionId: extra.sessionId ?? null,
      createdAt: at,
      metadata: {
        ...buildAgentSignalMetadata({
          source: extra.source ?? "web_player",
          ...(extra.ratio !== undefined
            ? { outcome: { type: "playback_completed", completionRatio: extra.ratio } }
            : {}),
        }),
        // Written raw: today's metadata sanitizer keeps only score/explanation
        // on `recommendation`, so a recorded `reasonCode` is seeded directly.
        ...(extra.recommendation ? { recommendation: extra.recommendation } : {}),
      },
    },
  });
}

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, into));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      collectKeys(entry, into);
    }
  }
  return into;
}

function allItems(journal: DiscoveryJournal): DiscoveryJournalItem[] {
  return journal.groups.flatMap((group) => group.items);
}

function itemFor(journal: DiscoveryJournal, trackId: string) {
  return allItems(journal).find((item) => item.trackId === trackId);
}

describe("DiscoveryJournalService (integration)", () => {
  const tasteMemory = new TasteMemoryService(new EventBus());
  const service = new DiscoveryJournalService(
    tasteMemory,
    new DiscoveryPolicyContextService(),
  );
  const tracks: Record<string, Seeded> = {};
  let journal: DiscoveryJournal;

  beforeAll(async () => {
    for (const id of [L1, L2, L3, L4, L5, L6]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.session.create({
      data: { id: `${TEST_PREFIX}session1`, userId: L1, budgetCapUsd: 1 },
    });

    for (const name of [
      "replay", "save", "library", "lowRatio", "noRatio", "late", "onlyComplete",
      "prior", "old", "other", "hidden",
    ]) {
      tracks[name] = await seedTrack(name, {
        releaseStatus: name === "hidden" ? "withdrawn" : "published",
      });
    }
    // Played through in the last 7 days with no follow-up, but never "almost there".
    tracks.pendingWithdrawn = await seedTrack("pendingWithdrawn", { releaseStatus: "withdrawn" });
    tracks.libBefore = await seedTrack("libBefore");
    tracks.hideArtistId = await seedTrack("hideArtistId");
    tracks.hideArtistName = await seedTrack("hideArtistName");
    tracks.hideGenre = await seedTrack("hideGenre", { genre: "Hidden Genre" });
    tracks.edgeSix = await seedTrack("edgeSix");
    tracks.edgeSeven = await seedTrack("edgeSeven");
    tracks.pendA = await seedTrack("pendA");
    tracks.pendB = await seedTrack("pendB");
    tracks.flip = await seedTrack("flip");
    // Two tracks by ONE artist, to prove a single next action per artist.
    tracks.twoA = await seedTrack("twoA");
    tracks.twoB = await seedTrack("twoB", { artistId: tracks.twoA.artistId });
    // A second track by the "prior" artist: the earlier interaction.
    tracks.priorOld = await seedTrack("priorOld", { artistId: tracks.prior.artistId });

    // A backable Shows campaign for the "save" artist only; a draft one for "replay".
    await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}campaign_open`,
        slug: `${TEST_PREFIX}open-show`,
        artistId: tracks.save.artistId,
        artistDisplayName: "Save Artist",
        title: "Open show",
        city: "Lyon",
        country: "FR",
        deadline: new Date(NOW.getTime() + 10 * 24 * HOUR),
        goalAmountUnits: "1000000",
        chainId: 31337,
        status: "active",
        campaignLevel: "active_escrow_campaign",
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}campaign_draft`,
        slug: `${TEST_PREFIX}draft-show`,
        artistId: tracks.replay.artistId,
        artistDisplayName: "Replay Artist",
        title: "Draft show",
        city: "Lyon",
        country: "FR",
        deadline: new Date(NOW.getTime() + 10 * 24 * HOUR),
        goalAmountUnits: "1000000",
        chainId: 31337,
        status: "draft",
        campaignLevel: "active_escrow_campaign",
      },
    });

    // --- Listener 1 -------------------------------------------------------
    // 90%+ then replay within 7 days -> resonates (first-time artist).
    await signal(L1, tracks.replay.trackId, "accept", ago(days(3) + 0.2));
    await signal(L1, tracks.replay.trackId, "complete", ago(days(3)), { ratio: 0.95 });
    await signal(L1, tracks.replay.trackId, "replay", ago(days(2)));

    // 90%+ then save within 7 days -> resonates; inside an agent session with
    // a recorded reason code.
    await signal(L1, tracks.save.trackId, "accept", ago(days(2) + 0.2), {
      recommendation: { score: 0.8, reasonCode: "taste_match" },
    });
    await signal(L1, tracks.save.trackId, "complete", ago(days(2)), {
      ratio: 1,
      sessionId: `${TEST_PREFIX}session1`,
    });
    await signal(L1, tracks.save.trackId, "save", ago(days(1)));

    // 90%+ then a library add within 7 days -> resonates.
    await signal(L1, tracks.library.trackId, "complete", ago(days(2)), { ratio: 0.92 });
    await prisma.libraryTrack.create({
      data: {
        userId: L1,
        source: "remote",
        title: "Track library",
        catalogTrackId: tracks.library.trackId,
        createdAt: ago(days(1)),
      },
    });

    // 80% + replay -> no. No recorded ratio + replay -> no. Replay on day 8 -> no.
    await signal(L1, tracks.lowRatio.trackId, "complete", ago(days(3)), { ratio: 0.8 });
    await signal(L1, tracks.lowRatio.trackId, "replay", ago(days(2)));
    await signal(L1, tracks.noRatio.trackId, "complete", ago(days(3)));
    await signal(L1, tracks.noRatio.trackId, "replay", ago(days(2)));
    await signal(L1, tracks.late.trackId, "complete", ago(days(10)), { ratio: 0.99 });
    await signal(L1, tracks.late.trackId, "replay", ago(days(2)));
    await signal(L1, tracks.onlyComplete.trackId, "complete", ago(days(2)), { ratio: 1 });

    // A previously played artist: an older interaction on another of their tracks.
    await signal(L1, tracks.priorOld.trackId, "accept", ago(days(20)));
    await signal(L1, tracks.prior.trackId, "complete", ago(days(3)), { ratio: 0.95 });
    await signal(L1, tracks.prior.trackId, "replay", ago(days(2)));

    // One artist, two resonant tracks -> only one next action.
    await signal(L1, tracks.twoA.trackId, "complete", ago(days(2)), { ratio: 1 });
    await signal(L1, tracks.twoA.trackId, "replay", ago(days(2) - 2));
    await signal(L1, tracks.twoB.trackId, "complete", ago(days(1) + 12), { ratio: 1 });
    await signal(L1, tracks.twoB.trackId, "save", ago(days(1)));

    // Resonant, but older than the headline week (still inside the 28-day window).
    await signal(L1, tracks.old.trackId, "complete", ago(days(15)), { ratio: 1 });
    await signal(L1, tracks.old.trackId, "replay", ago(days(14)));

    // Resonant, but the release was withdrawn -> not publicly visible.
    await signal(L1, tracks.hidden.trackId, "complete", ago(days(2)), { ratio: 1 });
    await signal(L1, tracks.hidden.trackId, "replay", ago(days(1)));

    // "Almost there" exclusions, all completed in the last 7 days with no follow-up.
    await signal(L1, tracks.pendingWithdrawn.trackId, "complete", ago(days(1)), { ratio: 1 });
    // Already in the library BEFORE the completion: not a follow-up, and a re-save is a no-op.
    await prisma.libraryTrack.create({
      data: {
        userId: L1,
        source: "remote",
        title: "Track libBefore",
        catalogTrackId: tracks.libBefore.trackId,
        createdAt: ago(days(5)),
      },
    });
    await signal(L1, tracks.libBefore.trackId, "complete", ago(days(1)), { ratio: 1 });
    await signal(L1, tracks.hideArtistId.trackId, "complete", ago(days(1)), { ratio: 1 });
    await signal(L1, tracks.hideArtistName.trackId, "complete", ago(days(1)), { ratio: 1 });
    await signal(L1, tracks.hideGenre.trackId, "complete", ago(days(1)), { ratio: 1 });
    await tasteMemory.upsertSignalControl(L1, {
      signalType: "artist",
      value: tracks.hideArtistId.artistId,
      action: "hidden",
    });
    await tasteMemory.upsertSignalControl(L1, {
      signalType: "artist",
      value: "Credited hideArtistName",
      action: "hidden",
    });
    await tasteMemory.upsertSignalControl(L1, {
      signalType: "genre",
      value: "Hidden Genre",
      action: "hidden",
    });
    // Window edge: 6 days ago is still pending, exactly 7 days ago is not.
    await signal(L1, tracks.edgeSix.trackId, "complete", ago(days(6)), { ratio: 1 });
    await signal(L1, tracks.edgeSeven.trackId, "complete", ago(days(7)), { ratio: 1 });

    // --- Listener 5: played through twice, nothing resonated yet. -----------
    await signal(L5, tracks.pendA.trackId, "complete", ago(days(3)), { ratio: 0.97 });
    await signal(L5, tracks.pendB.trackId, "complete", ago(days(1)), { ratio: 1 });
    await signal(L5, tracks.pendB.trackId, "skip", ago(12));

    // --- Listener 2: resonance on their own track, plus an old signal on the
    // artist of listener 1's "replay" track that must never leak into L1. -----
    await signal(L2, tracks.other.trackId, "complete", ago(days(2)), { ratio: 1 });
    await signal(L2, tracks.other.trackId, "replay", ago(days(1)));
    await signal(L2, tracks.replay.trackId, "accept", ago(days(30)));
    await signal(L2, tracks.save.trackId, "complete", ago(days(2)), { ratio: 1 });
    await signal(L2, tracks.save.trackId, "save", ago(days(1)));

    journal = await service.getJournal(L1, { now: NOW });
  });

  afterAll(async () => {
    const users = [L1, L2, L3, L4, L5, L6, N1, N2, N3, OWNER];
    await prisma.stemListing.deleteMany({ where: { transactionHash: { startsWith: TEST_PREFIX } } });
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } });
    await prisma.agentSignal.deleteMany({ where: { userId: { in: users } } });
    await prisma.libraryTrack.deleteMany({ where: { userId: { in: users } } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { in: users } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: users } } });
    await prisma.showCampaign.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.session.deleteMany({ where: { userId: { in: users } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: OWNER } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  describe("resonance rule", () => {
    it("returns the versioned contract", () => {
      expect(journal.schemaVersion).toBe(DISCOVERY_JOURNAL_SCHEMA_VERSION);
      expect(journal.window.days).toBe(28);
      expect(journal.window.to).toBe(NOW.toISOString());
      expect(journal.window.from).toBe(ago(days(28)).toISOString());
    });

    it("resonates at >=90% played plus a replay within 7 days", () => {
      const item = itemFor(journal, tracks.replay.trackId);
      expect(item).toMatchObject({
        title: "Track replay",
        followUp: "replayed",
        resonatedAt: ago(days(3)).toISOString(),
        releaseId: tracks.replay.releaseId,
        artistName: "Credited replay",
      });
    });

    it("resonates at >=90% played plus a save within 7 days", () => {
      expect(itemFor(journal, tracks.save.trackId)).toMatchObject({ followUp: "saved" });
    });

    it("counts a library add as a save", () => {
      expect(itemFor(journal, tracks.library.trackId)).toMatchObject({ followUp: "saved" });
    });

    it("does not resonate at 80% even with a replay", () => {
      expect(itemFor(journal, tracks.lowRatio.trackId)).toBeUndefined();
    });

    it("does not resonate when no completion ratio was recorded", () => {
      expect(itemFor(journal, tracks.noRatio.trackId)).toBeUndefined();
    });

    it("does not resonate when the replay lands 8 days after the completion", () => {
      expect(itemFor(journal, tracks.late.trackId)).toBeUndefined();
    });

    it("does not resonate without any replay or save", () => {
      expect(itemFor(journal, tracks.onlyComplete.trackId)).toBeUndefined();
    });

    it("hides tracks that are not publicly visible", () => {
      expect(itemFor(journal, tracks.hidden.trackId)).toBeUndefined();
    });

    it("keeps resonant tracks older than a week inside the window", () => {
      expect(itemFor(journal, tracks.old.trackId)).toBeDefined();
    });

    it("honors a shorter window", async () => {
      const short = await service.getJournal(L1, { now: NOW, windowDays: 5 });
      expect(allItems(short).map((item) => item.trackId)).not.toContain(tracks.old.trackId);
      expect(itemFor(short, tracks.replay.trackId)).toBeDefined();
      expect(short.window.days).toBe(5);
    });

    it("does not count a follow-up that has not happened by `now`", async () => {
      const earlier = await service.getJournal(L1, { now: ago(days(2) + 12) });
      // Completion at -3d, replay only at -2d: the replay is still in the future.
      expect(itemFor(earlier, tracks.replay.trackId)).toBeUndefined();
    });
  });

  describe("discovery flag and headline", () => {
    it("flags a first-time artist as a discovery", () => {
      expect(itemFor(journal, tracks.replay.trackId)?.discovery).toBe(true);
      expect(itemFor(journal, tracks.save.trackId)?.discovery).toBe(true);
    });

    it("does not flag a previously played artist", () => {
      expect(itemFor(journal, tracks.prior.trackId)?.discovery).toBe(false);
    });

    it("counts resonant discoveries and new artists over the last 7 days only", () => {
      // replay, save, library, twoA are this week's discoveries; twoB is the
      // same artist as twoA, prior is not new, old is older than a week.
      expect(journal.headline).toEqual({
        resonantDiscoveriesThisWeek: 4,
        newArtistsThisWeek: 4,
      });
    });
  });

  describe("reason, next action and grouping", () => {
    it("uses the recorded reason code from the shared vocabulary", () => {
      expect(itemFor(journal, tracks.save.trackId)?.reason).toEqual({
        code: "taste_match",
        text: DISCOVERY_EXPLANATIONS.taste_match,
      });
    });

    it("falls back to a categorical listening-pattern reason", () => {
      expect(itemFor(journal, tracks.replay.trackId)?.reason).toEqual({
        code: "listening_pattern",
        text: DISCOVERY_EXPLANATIONS.listening_pattern,
      });
    });

    it("gives exactly one next action per artist", () => {
      const items = allItems(journal);
      const withAction = items.filter((item) => item.nextAction !== null);
      const artistIds = items.map((item) => item.artistId);
      expect(withAction.map((item) => item.artistId).sort()).toEqual(
        [...new Set(artistIds)].sort(),
      );
      const twoArtist = items.filter((item) => item.artistId === tracks.twoA.artistId);
      expect(twoArtist).toHaveLength(2);
      expect(twoArtist.filter((item) => item.nextAction !== null)).toHaveLength(1);
    });

    it("links an open Shows campaign, else the artist page", () => {
      expect(itemFor(journal, tracks.save.trackId)?.nextAction).toEqual({
        kind: "show_campaign",
        label: "See their show campaign",
        href: `/shows/${TEST_PREFIX}open-show`,
      });
      // Draft campaigns are not offered.
      expect(itemFor(journal, tracks.replay.trackId)?.nextAction).toEqual({
        kind: "artist_page",
        label: "Visit artist page",
        href: `/artist/${tracks.replay.artistId}`,
      });
    });

    it("groups by session when present, else by UTC day, newest first", () => {
      const sessionGroup = journal.groups.find((group) => group.sessionId !== null);
      expect(sessionGroup).toMatchObject({
        key: `session:${TEST_PREFIX}session1`,
        sessionId: `${TEST_PREFIX}session1`,
      });
      expect(sessionGroup?.items.map((item) => item.trackId)).toEqual([tracks.save.trackId]);

      const dayGroups = journal.groups.filter((group) => group.sessionId === null);
      for (const group of dayGroups) {
        expect(group.key).toBe(`day:${group.date}`);
        for (const item of group.items) {
          expect(item.resonatedAt.slice(0, 10)).toBe(group.date);
        }
      }
      const newest = journal.groups.map((group) => group.items[0].resonatedAt);
      expect([...newest].sort().reverse()).toEqual(newest);
    });

    it("applies the item limit but keeps the headline", async () => {
      const limited = await service.getJournal(L1, { now: NOW, limit: 1 });
      expect(allItems(limited)).toHaveLength(1);
      expect(limited.headline).toEqual(journal.headline);
    });
  });

  describe("per-listener scoping", () => {
    it("never shows another listener's resonance", async () => {
      expect(itemFor(journal, tracks.other.trackId)).toBeUndefined();
      const other = await service.getJournal(L2, { now: NOW });
      expect(allItems(other).map((item) => item.trackId).sort()).toEqual(
        [tracks.other.trackId, tracks.save.trackId].sort(),
      );
    });

    it("does not let another listener's history change the discovery flag", () => {
      // L2 touched the "replay" artist 30 days ago; L1 is still its first listener.
      expect(itemFor(journal, tracks.replay.trackId)?.discovery).toBe(true);
    });

    it("does not let another listener's saves or follow-ups qualify a track", async () => {
      // L1's "onlyComplete" track stays unresonant, and L2 (who never played
      // it) gets nothing for it either.
      const other = await service.getJournal(L2, { now: NOW });
      expect(itemFor(other, tracks.onlyComplete.trackId)).toBeUndefined();
      expect(itemFor(journal, tracks.other.trackId)).toBeUndefined();
    });

    it("returns an empty journal for a listener with no signals", async () => {
      const empty = await service.getJournal(`${TEST_PREFIX}nobody`, { now: NOW });
      expect(empty.groups).toEqual([]);
      expect(empty.headline).toEqual({ resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 });
    });
  });

  describe("consent", () => {
    it("hides agent-originated playback when agent-playback training is off", async () => {
      const agentTrack = await seedTrack("agentOrigin");
      await signal(L3, agentTrack.trackId, "complete", ago(days(2)), {
        ratio: 1,
        source: "agent_session",
      });
      await signal(L3, agentTrack.trackId, "replay", ago(days(1)), { source: "agent_session" });

      // Default: training on, agent playback is usable.
      const allowed = await service.getJournal(L3, { now: NOW });
      expect(itemFor(allowed, agentTrack.trackId)).toMatchObject({ discovery: true });

      await tasteMemory.updateSettings(L3, { agentPlaybackTrainingEnabled: false });
      const denied = await service.getJournal(L3, { now: NOW });
      expect(itemFor(denied, agentTrack.trackId)).toBeUndefined();
      expect(allItems(denied)).toEqual([]);
    });

    it("keeps listener-initiated playback when agent-playback training is off", async () => {
      const ownTrack = await seedTrack("ownPlay");
      await signal(L3, ownTrack.trackId, "complete", ago(days(2)), { ratio: 1 });
      await signal(L3, ownTrack.trackId, "replay", ago(days(1)));
      const journalOff = await service.getJournal(L3, { now: NOW });
      expect(itemFor(journalOff, ownTrack.trackId)).toBeDefined();
    });

    it("forgets everything recorded before a taste reset", async () => {
      const resetTrack = await seedTrack("resetTrack");
      const afterTrack = await seedTrack("afterReset");
      await signal(L4, resetTrack.trackId, "complete", ago(days(3)), { ratio: 1 });
      await signal(L4, resetTrack.trackId, "replay", ago(days(2)));
      // Reset at -1d: a prior interaction with the later track's artist is forgotten too.
      await signal(L4, afterTrack.trackId, "accept", ago(days(5)));
      await prisma.listenerTasteMemorySettings.create({
        data: {
          userId: L4,
          socialMatchingEnabled: false,
          citySceneDiscoveryEnabled: false,
          agentPlaybackTrainingEnabled: true,
          recommendationExplanationPreference: "balanced",
          resetAt: ago(days(1)),
        },
      });
      await signal(L4, afterTrack.trackId, "complete", ago(12), { ratio: 1 });
      await signal(L4, afterTrack.trackId, "replay", ago(6));

      const reset = await service.getJournal(L4, { now: NOW });
      expect(allItems(reset).map((item) => item.trackId)).toEqual([afterTrack.trackId]);
      // The pre-reset accept on the same artist no longer makes it "known".
      expect(itemFor(reset, afterTrack.trackId)?.discovery).toBe(true);
    });
  });

  describe("reason fallbacks", () => {
    it("labels a discovery by a verified human artist as a discovery pick", async () => {
      await prisma.user.create({ data: { id: OWNER, email: `${OWNER}@test.resonate` } });
      await prisma.artist.create({
        data: { id: `${TEST_PREFIX}artist_verified`, userId: OWNER, displayName: "Verified" },
      });
      await prisma.curatorReputation.create({
        data: { walletAddress: OWNER, humanVerificationStatus: "human_verified", humanVerifiedAt: ago(days(40)) },
      });
      const verified = await seedTrack("verified", { artistId: `${TEST_PREFIX}artist_verified` });
      await signal(L4, verified.trackId, "complete", ago(10), { ratio: 1 });
      await signal(L4, verified.trackId, "save", ago(9));

      const result = await service.getJournal(L4, { now: NOW });
      expect(itemFor(result, verified.trackId)?.reason).toEqual({
        code: "discovery_pick",
        text: DISCOVERY_EXPLANATIONS.discovery_pick,
      });
    });

    it("ignores a recorded reason code outside the shared vocabulary", async () => {
      const bogus = await seedTrack("bogusReason");
      await signal(L4, bogus.trackId, "accept", ago(11), {
        recommendation: { reasonCode: "because-you-paid", explanation: ["free text"] },
      });
      await signal(L4, bogus.trackId, "complete", ago(10), { ratio: 1 });
      await signal(L4, bogus.trackId, "replay", ago(9));

      const result = await service.getJournal(L4, { now: NOW });
      expect(itemFor(result, bogus.trackId)?.reason.code).toBe("listening_pattern");
      expect(JSON.stringify(result)).not.toContain("because-you-paid");
    });
  });

  describe("pending (almost there)", () => {
    const pendingIds = (result: DiscoveryJournal) => result.pending.map((item) => item.trackId);

    it("lists a track played through in the last 7 days with no replay or save", () => {
      const item = journal.pending.find((entry) => entry.trackId === tracks.onlyComplete.trackId);
      expect(item).toEqual({
        trackId: tracks.onlyComplete.trackId,
        title: "Track onlyComplete",
        artistId: tracks.onlyComplete.artistId,
        artistName: "Credited onlyComplete",
        releaseId: tracks.onlyComplete.releaseId,
        releaseTitle: "Release onlyComplete",
        artworkUrl: null,
        hasUploadedArtwork: false,
        artworkRevision: expect.any(Number),
        completedAt: ago(days(2)).toISOString(),
        followUpBy: new Date(
          ago(days(2)).getTime() + RESONANCE_FOLLOW_UP_DAYS * 24 * HOUR,
        ).toISOString(),
        discovery: true,
      });
      // Not a resonated item.
      expect(itemFor(journal, tracks.onlyComplete.trackId)).toBeUndefined();
    });

    it("orders pending by completion, newest first, within the 7-day window edge", () => {
      // 6 days ago is inside the window, exactly 7 days ago is not.
      expect(pendingIds(journal)).toEqual([tracks.onlyComplete.trackId, tracks.edgeSix.trackId]);
    });

    it("never lists resonated tracks", () => {
      for (const name of ["replay", "save", "library", "twoA", "twoB", "prior", "old"]) {
        expect(pendingIds(journal)).not.toContain(tracks[name].trackId);
      }
    });

    it("never lists low-ratio, no-ratio or stale completions", () => {
      for (const name of ["lowRatio", "noRatio", "late", "edgeSeven"]) {
        expect(pendingIds(journal)).not.toContain(tracks[name].trackId);
      }
    });

    it("never lists a track that is not publicly available", () => {
      expect(pendingIds(journal)).not.toContain(tracks.pendingWithdrawn.trackId);
    });

    it("never lists a track already in the library, even if added before the completion", () => {
      expect(pendingIds(journal)).not.toContain(tracks.libBefore.trackId);
    });

    it("never lists a track hidden through taste memory (artist id, artist name or genre)", () => {
      for (const name of ["hideArtistId", "hideArtistName", "hideGenre"]) {
        expect(pendingIds(journal)).not.toContain(tracks[name].trackId);
      }
    });

    it("keeps pending when no track resonated at all", async () => {
      const result = await service.getJournal(L5, { now: NOW });
      expect(result.groups).toEqual([]);
      expect(result.headline).toEqual({ resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 });
      expect(pendingIds(result)).toEqual([tracks.pendB.trackId, tracks.pendA.trackId]);
    });

    it("scopes pending to the listener", async () => {
      expect(pendingIds(journal)).not.toContain(tracks.pendA.trackId);
      expect(pendingIds(journal)).not.toContain(tracks.pendB.trackId);
      const other = await service.getJournal(L2, { now: NOW });
      expect(other.pending).toEqual([]);
    });

    it("returns an empty pending list for a listener with no signals", async () => {
      const nobody = await service.getJournal(`${TEST_PREFIX}nobody`, { now: NOW });
      expect(nobody.pending).toEqual([]);
    });

    it("moves a track out of pending and into the journal once it is saved", async () => {
      await signal(L6, tracks.flip.trackId, "complete", ago(days(1)), { ratio: 1 });
      const before = await service.getJournal(L6, { now: NOW });
      expect(pendingIds(before)).toEqual([tracks.flip.trackId]);
      expect(allItems(before)).toEqual([]);

      await prisma.libraryTrack.create({
        data: {
          userId: L6,
          source: "remote",
          title: "Track flip",
          catalogTrackId: tracks.flip.trackId,
          createdAt: ago(12),
        },
      });
      const after = await service.getJournal(L6, { now: NOW });
      expect(after.pending).toEqual([]);
      expect(itemFor(after, tracks.flip.trackId)).toMatchObject({ followUp: "saved" });
    });

    it("caps the list at PENDING_LIMIT, newest first", async () => {
      const extra = PENDING_LIMIT + 1;
      const seeded: Seeded[] = [];
      for (let index = 0; index < extra; index += 1) {
        seeded.push(await seedTrack(`cap${index}`));
      }
      for (const [index, entry] of seeded.entries()) {
        // cap0 is the newest completion; the oldest one falls off the cap.
        await signal(L5, entry.trackId, "complete", ago(1 + index), { ratio: 1 });
      }
      const result = await service.getJournal(L5, { now: NOW });
      expect(result.pending).toHaveLength(PENDING_LIMIT);
      expect(pendingIds(result).slice(0, 3)).toEqual(seeded.slice(0, 3).map((entry) => entry.trackId));
      expect(pendingIds(result)).not.toContain(seeded[extra - 1].trackId);
    });
  });

  describe("new from artists you discovered", () => {
    const ids = (result: DiscoveryJournal) => result.newFromDiscovered.map((item) => item.trackId);
    // Every scenario artist resonated with a "base" track: complete 10 days ago,
    // replay 9 days ago. Releases created after that are "new".
    const FIRST_RESONANT = ago(days(10));
    const nr: Record<string, Seeded> = {};
    let result: DiscoveryJournal;
    let wide: DiscoveryJournal;

    async function journalArtist(listener: string, name: string) {
      const base = await seedTrack(`${name}Base`, { createdAt: ago(days(100)) });
      await signal(listener, base.trackId, "complete", FIRST_RESONANT, { ratio: 1 });
      await signal(listener, base.trackId, "replay", ago(days(9)));
      return base;
    }
    async function newRelease(
      name: string,
      base: Seeded,
      createdAt: Date,
      options: Parameters<typeof seedTrack>[1] = {},
    ) {
      nr[name] = await seedTrack(name, { ...options, artistId: base.artistId, createdAt });
      return nr[name];
    }

    beforeAll(async () => {
      for (const id of [N1, N2, N3]) {
        await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
      }

      // Included: positive control, a rich item, and the ADR-TE-2 shape.
      const ok = await journalArtist(N1, "nrOk");
      await newRelease("nrOkNew", ok, ago(days(5)));

      // Diversity: three recent releases by one artist -> the newest two.
      const cap = await journalArtist(N1, "nrCap");
      await newRelease("nrCap1", cap, ago(days(1)));
      await newRelease("nrCap3", cap, ago(days(3)));
      await newRelease("nrCap6", cap, ago(days(6)));

      // Excluded by exactly one property each.
      const early = await journalArtist(N1, "nrEarly");
      await newRelease("nrEarlyNew", early, ago(days(11))); // before the first resonant listen
      await newRelease("nrEqualNew", early, FIRST_RESONANT); // not strictly after it
      const played = await journalArtist(N1, "nrPlayed");
      await newRelease("nrPlayedNew", played, ago(days(5)));
      await signal(N1, nr.nrPlayedNew.trackId, "skip", ago(days(2)));
      const saved = await journalArtist(N1, "nrSaved");
      await newRelease("nrSavedNew", saved, ago(days(5)));
      await prisma.libraryTrack.create({
        data: {
          userId: N1,
          source: "remote",
          title: "Track nrSavedNew",
          catalogTrackId: nr.nrSavedNew.trackId,
          createdAt: ago(days(4)),
        },
      });
      const hiddenArtist = await journalArtist(N1, "nrHiddenArtist");
      await newRelease("nrHiddenArtistNew", hiddenArtist, ago(days(5)));
      const hiddenGenre = await journalArtist(N1, "nrHiddenGenre");
      await newRelease("nrHiddenGenreNew", hiddenGenre, ago(days(5)), { genre: "Hidden Genre" });
      await tasteMemory.upsertSignalControl(N1, {
        signalType: "artist",
        value: hiddenArtist.artistId,
        action: "hidden",
      });
      await tasteMemory.upsertSignalControl(N1, {
        signalType: "genre",
        value: "Hidden Genre",
        action: "hidden",
      });
      const withdrawn = await journalArtist(N1, "nrWithdrawn");
      await newRelease("nrWithdrawnNew", withdrawn, ago(days(5)), { releaseStatus: "withdrawn" });
      const aiAll = await journalArtist(N1, "nrAiAll");
      await newRelease("nrAiAllNew", aiAll, ago(days(5)), { aiDisclosureLevel: "ALL" });
      // Only fully AI-generated content is excluded; partly AI is eligible.
      const aiPartly = await journalArtist(N1, "nrAiPartly");
      await newRelease("nrAiPartlyNew", aiPartly, ago(days(7)), { aiDisclosureLevel: "PARTLY" });

      // Another listener's play of the same track does not exclude it for N1.
      const otherPlayed = await journalArtist(N1, "nrOtherPlayed");
      await newRelease("nrOtherPlayedNew", otherPlayed, ago(days(4)));
      await signal(N2, nr.nrOtherPlayedNew.trackId, "skip", ago(days(2)));

      // ADR-TE-2 rule 1: a listing on the later-position track must not reorder it.
      const listed = await journalArtist(N1, "nrListed");
      await newRelease("nrListedFirst", listed, ago(days(8)));
      nr.nrListedSecond = {
        artistId: listed.artistId,
        releaseId: nr.nrListedFirst.releaseId,
        trackId: `${TEST_PREFIX}track_nrListedSecond`,
      };
      await prisma.track.create({
        data: {
          id: nr.nrListedSecond.trackId,
          releaseId: nr.nrListedFirst.releaseId,
          title: "Track nrListedSecond",
          position: 2,
        },
      });

      // Per-listener scoping: only N2's journal has this artist.
      const n2Only = await journalArtist(N2, "nrN2Only");
      await newRelease("nrN2OnlyNew", n2Only, ago(days(3)));

      // Older than 60 days but after the first resonant listen (window 90 only).
      const ancient = await seedTrack("nrAncientBase", { createdAt: ago(days(200)) });
      await signal(N1, ancient.trackId, "complete", ago(days(80)), { ratio: 1 });
      await signal(N1, ancient.trackId, "replay", ago(days(79)));
      await newRelease("nrAncient70", ancient, ago(days(70)));
      await newRelease("nrAncient55", ancient, ago(days(55)));

      result = await service.getJournal(N1, { now: NOW });
      wide = await service.getJournal(N1, { now: NOW, windowDays: 90 });
    });

    it("lists new releases by journal artists, newest release first, with the documented shape", () => {
      expect(ids(result)).toEqual([
        nr.nrCap1.trackId,
        nr.nrCap3.trackId,
        nr.nrOtherPlayedNew.trackId,
        nr.nrOkNew.trackId,
        nr.nrAiPartlyNew.trackId,
        nr.nrListedFirst.trackId,
        nr.nrListedSecond.trackId,
      ]);
      expect(result.newFromDiscovered.find((item) => item.trackId === nr.nrOkNew.trackId)).toEqual({
        trackId: nr.nrOkNew.trackId,
        title: "Track nrOkNew",
        artistId: nr.nrOkNew.artistId,
        artistName: "Credited nrOkNew",
        releaseId: nr.nrOkNew.releaseId,
        releaseTitle: "Release nrOkNew",
        artworkUrl: null,
        hasUploadedArtwork: false,
        artworkRevision: expect.any(Number),
        addedAt: ago(days(5)).toISOString(),
        reason: {
          code: "new_from_discovered_artist",
          text: DISCOVERY_EXPLANATIONS.new_from_discovered_artist,
        },
      });
      expect(result.schemaVersion).toBe(DISCOVERY_JOURNAL_SCHEMA_VERSION);
    });

    it("keeps at most two tracks per artist, the newest releases", () => {
      expect(ids(result)).toContain(nr.nrCap1.trackId);
      expect(ids(result)).toContain(nr.nrCap3.trackId);
      expect(ids(result)).not.toContain(nr.nrCap6.trackId);
      expect(result.newFromDiscovered.length).toBeLessThanOrEqual(NEW_RELEASES_LIMIT);
    });

    it("excludes releases that arrived before (or exactly at) the first resonant listen", () => {
      expect(ids(result)).not.toContain(nr.nrEarlyNew.trackId);
      expect(ids(result)).not.toContain(nr.nrEqualNew.trackId);
    });

    it("excludes releases older than 60 days, and keeps newer ones for the same artist", () => {
      expect(ids(wide)).not.toContain(nr.nrAncient70.trackId);
      expect(ids(wide)).toContain(nr.nrAncient55.trackId);
    });

    it("excludes tracks the listener already played or saved", () => {
      expect(ids(result)).not.toContain(nr.nrPlayedNew.trackId);
      expect(ids(result)).not.toContain(nr.nrSavedNew.trackId);
    });

    it("is not affected by another listener's plays", () => {
      expect(ids(result)).toContain(nr.nrOtherPlayedNew.trackId);
    });

    it("excludes artists and genres hidden through taste memory", () => {
      expect(ids(result)).not.toContain(nr.nrHiddenArtistNew.trackId);
      expect(ids(result)).not.toContain(nr.nrHiddenGenreNew.trackId);
    });

    it("excludes withdrawn releases and fully AI-generated tracks, not partly AI ones", () => {
      expect(ids(result)).not.toContain(nr.nrWithdrawnNew.trackId);
      expect(ids(result)).not.toContain(nr.nrAiAllNew.trackId);
      expect(ids(result)).toContain(nr.nrAiPartlyNew.trackId);
    });

    it("never lists releases created after `now`", async () => {
      // Every release of the shared fixture was created at wall-clock time, after NOW.
      expect(journal.newFromDiscovered).toEqual([]);
    });

    it("scopes the list to the listener's own journal", async () => {
      expect(ids(result)).not.toContain(nr.nrN2OnlyNew.trackId);
      const other = await service.getJournal(N2, { now: NOW });
      expect(ids(other)).toEqual([nr.nrN2OnlyNew.trackId]);
    });

    it("returns an empty list for a listener with no resonant tracks", async () => {
      const none = await service.getJournal(N3, { now: NOW });
      expect(none.newFromDiscovered).toEqual([]);
      const nobody = await service.getJournal(`${TEST_PREFIX}nobody`, { now: NOW });
      expect(nobody.newFromDiscovered).toEqual([]);
    });

    it("is not influenced by stem listings (ADR-TE-2 rule 1)", async () => {
      const stem = await prisma.stem.create({
        data: { trackId: nr.nrListedSecond.trackId, type: "vocals", uri: "s3://test/stem" },
      });
      await prisma.stemListing.create({
        data: {
          listingId: BigInt(Date.now()),
          stemId: stem.id,
          tokenId: BigInt(1),
          chainId: 31337,
          contractAddress: "0x0000000000000000000000000000000000000001",
          sellerAddress: "0x0000000000000000000000000000000000000002",
          pricePerUnit: "1000000",
          amount: BigInt(10),
          paymentToken: "0x0000000000000000000000000000000000000003",
          expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR),
          transactionHash: `${TEST_PREFIX}listing_tx`,
          blockNumber: BigInt(1),
          listedAt: ago(days(1)),
          status: "active",
        },
      });
      const withListing = await service.getJournal(N1, { now: NOW });
      expect(withListing.newFromDiscovered).toEqual(result.newFromDiscovered);

      await prisma.stemListing.deleteMany({ where: { stemId: stem.id } });
      const without = await service.getJournal(N1, { now: NOW });
      expect(without.newFromDiscovered).toEqual(withListing.newFromDiscovered);
      await prisma.stem.delete({ where: { id: stem.id } });
    });

    it("carries no price, spend, license or transaction fields", () => {
      const keys = [...collectKeys(result.newFromDiscovered)];
      const forbidden = /price|spend|spent|cost|usd|license|transaction|wallet|payment|amount|userId|listing|stem/i;
      expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
    });
  });

  describe("privacy of the payload", () => {
    it("carries no price, spend, license or transaction fields", () => {
      const keys = [...collectKeys(journal)];
      const forbidden = /price|spend|spent|cost|usd|license|transaction|wallet|payment|amount|userId/i;
      expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
    });
  });
});
