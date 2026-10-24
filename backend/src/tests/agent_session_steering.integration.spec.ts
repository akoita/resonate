/**
 * In-session steering (#2247) against real Postgres. The session's own
 * AgentSignal rows (skips and "Not this", saves, finishes) nudge the next picks
 * of that session: a bounded, decaying term that works inside a request tier.
 * Nothing new is stored; Home is unaffected.
 *
 * Catalog: two unique genres. `drum` tracks are slightly preferred (a learned
 * genre weight), so without any signal the first batch is all drum. Each
 * performer has one candidate track and one track the session already played.
 */
import { prisma } from "../db/prisma";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { requestScopeFor } from "../modules/agents/agent_session_request";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { DISCOVERY_EXPLANATION_VARIANTS } from "../modules/recommendations/discovery-explanations";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `steer_${Date.now()}_`;
const UNIQ = `zq${Date.now().toString(36)}`;
const DRUM = `Drumline ${UNIQ}`;
const HARP = `Harpsong ${UNIQ}`;
const LISTENER = `${TEST_PREFIX}listener`;
const OTHER = `${TEST_PREFIX}other`;
const UPLOADER = `${TEST_PREFIX}uploader`;
const key = (name: string) => `${TEST_PREFIX}${name}`;
const COUNT = 5;
const nums = Array.from({ length: COUNT }, (_, index) => index + 1);
/** Candidate tracks (never played in the session) and played tracks, by performer. */
const drum = nums.map((n) => `drum${n}`);
const harp = nums.map((n) => `harp${n}`);
const drumPlayed = nums.map((n) => `drumplayed${n}`);
const harpPlayed = nums.map((n) => `harpplayed${n}`);
const performerOf = (name: string) => `Performer ${name.replace(/played/, "")} ${UNIQ}`;
const allTracks = [...drum, ...harp, ...drumPlayed, ...harpPlayed];
const genreOf = (name: string) => (name.startsWith("drum") ? DRUM : HARP);

describe("AI DJ in-session steering (integration)", () => {
  const policyContext = new DiscoveryPolicyContextService();
  const ranking = new DiscoveryRankingService();
  const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
  const selector = new AgentSelectorService(tools, ranking, undefined, undefined, undefined, undefined, policyContext);
  const sessionIds: string[] = [];

  const newSession = async (userId = LISTENER) => {
    const session = await prisma.session.create({ data: { userId, budgetCapUsd: 10, spentUsd: 0 } });
    sessionIds.push(session.id);
    return session.id;
  };
  const signal = (
    sessionId: string | null,
    trackName: string,
    action: string,
    extra: { userId?: string; agentSessionId?: string } = {},
  ) =>
    prisma.agentSignal.create({
      data: {
        userId: extra.userId ?? LISTENER,
        sessionId,
        trackId: key(trackName),
        action,
        weight: action === "skip" ? -1 : 1.5,
        ...(extra.agentSessionId ? { metadata: { agentSessionId: extra.agentSessionId } } : {}),
      },
    });
  /** A pick the session made later than every signal written so far (future-dated so the order is certain). */
  const laterPicks = async (sessionId: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      await prisma.license.create({
        data: {
          sessionId,
          trackId: key("drumplayed1"),
          type: "personal",
          priceUsd: 0,
          durationSeconds: 0,
          pickNote: {
            create: {
              userId: LISTENER,
              explanation: [],
              curatedBy: "rules",
              createdAt: new Date(Date.now() + 60_000 + index),
            },
          },
        },
      });
    }
  };
  const played = [...drumPlayed, ...harpPlayed].map(key);
  const select = (sessionId: string | undefined, extra: Record<string, unknown> = {}) =>
    selector.select({
      userId: LISTENER,
      ...(sessionId ? { sessionId } : {}),
      queries: [DRUM, HARP],
      recentTrackIds: played,
      learnedGenreWeights: { [DRUM]: 5 },
      limit: 4,
      useEmbeddings: false,
      allowExplicit: false,
      ...extra,
    });
  const mine = (result: Awaited<ReturnType<typeof select>>) =>
    result.selected.filter((track) => track.id.startsWith(TEST_PREFIX));
  const names = (ids: string[]) => ids.map((id) => id.slice(TEST_PREFIX.length));
  const signalOf = (result: Awaited<ReturnType<typeof select>>, trackName: string) => {
    const track = (result as any).selected.find((entry: any) => entry.id === key(trackName));
    return track?.agentRecommendation.signals.find((entry: any) => entry.label === "session_steering");
  };
  /** The steering term a track carries when the whole pool is selected, not only the batch of 4. */
  const wholePool = (sessionId: string, extra: Record<string, unknown> = {}) => select(sessionId, { limit: 50, ...extra });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [LISTENER, OTHER, UPLOADER].map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.artist.create({
      data: { id: key("artist"), userId: UPLOADER, displayName: "Fixture uploader", payoutAddress: `0x${"e".repeat(40)}` },
    });
    const newest = Date.now() + 120_000;
    await prisma.release.createMany({
      data: allTracks.map((name, index) => ({
        id: key(`rel_${name}`),
        artistId: key("artist"),
        title: `Release ${name} ${UNIQ}`,
        primaryArtist: performerOf(name),
        genre: genreOf(name),
        status: "published",
        createdAt: new Date(newest - index * 1000),
      })),
    });
    await prisma.track.createMany({
      data: allTracks.map((name, index) => ({
        id: key(name),
        releaseId: key(`rel_${name}`),
        title: `Piece ${name} ${UNIQ}`,
        artist: performerOf(name),
        position: 1,
        createdAt: new Date(newest - index * 1000),
      })),
    });
  });

  afterEach(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { in: [LISTENER, OTHER] } } });
  });

  afterAll(async () => {
    await prisma.license.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [LISTENER, OTHER, UPLOADER] } } }).catch(() => {});
  });

  it("without any signal the favoured genre leads, and nothing is steered", async () => {
    const sessionId = await newSession();
    const result = await select(sessionId);
    expect(names(mine(result).map((track) => track.id)).every((name) => name.startsWith("drum"))).toBe(true);
    expect(mine(result)).toHaveLength(4);
    expect(signalOf(await wholePool(sessionId), "drum1")).toBeUndefined();
    expect(JSON.stringify(result.selected)).not.toContain(DISCOVERY_EXPLANATION_VARIANTS.steered_away);
  });

  it("after three skips of one genre the next picks shift away from it, in the same session", async () => {
    const sessionId = await newSession();
    for (const name of drumPlayed.slice(0, 3)) await signal(sessionId, name, "skip");

    const result = await select(sessionId);
    const picked = names(mine(result).map((track) => track.id));
    expect(picked).toHaveLength(4);
    expect(picked.every((name) => name.startsWith("harp"))).toBe(true);
    // The pick says why: it took the place of a demoted one.
    for (const track of mine(result)) {
      expect((track as any).agentRecommendation.explanation[0]).toBe(DISCOVERY_EXPLANATION_VARIANTS.steered_away);
    }
    // The skipped genre is bounded at -15 in the ranking trace.
    expect(signalOf(await wholePool(sessionId), "drum1")).toMatchObject({ weight: -15 });
  });

  it("ranks a different session exactly as it ranked before: the steering is session-scoped", async () => {
    const skipped = await newSession();
    const fresh = await newSession();
    for (const name of drumPlayed.slice(0, 3)) await signal(skipped, name, "skip");

    const baseline = await select(fresh);
    expect(names(mine(baseline).map((track) => track.id)).every((name) => name.startsWith("drum"))).toBe(true);
    expect(signalOf(await wholePool(fresh), "drum1")).toBeUndefined();
    // Another listener's skips on the same session id steer nothing either.
    const other = await newSession(OTHER);
    for (const name of drumPlayed.slice(0, 3)) await signal(other, name, "skip", { userId: OTHER });
    const sameIdOtherUser = await wholePool(other);
    expect(signalOf(sameIdOtherUser, "drum1")).toBeUndefined();
  });

  it("counts playback signals mirrored by analytics, which carry the DJ session in their metadata", async () => {
    const sessionId = await newSession();
    const elsewhere = await newSession();
    for (const name of drumPlayed.slice(0, 3)) await signal(null, name, "skip", { agentSessionId: sessionId });

    const steered = await wholePool(sessionId);
    expect(signalOf(steered, "drum1")).toMatchObject({ weight: -15 });
    const unrelated = await wholePool(elsewhere);
    expect(signalOf(unrelated, "drum1")).toBeUndefined();
  });

  it("saves and finishes lift their genre, and the pick says so", async () => {
    const sessionId = await newSession();
    await signal(sessionId, "harpplayed1", "complete");
    await signal(sessionId, "harpplayed2", "save");
    await signal(sessionId, "harpplayed3", "complete");

    const result = await select(sessionId);
    const picked = names(mine(result).map((track) => track.id));
    expect(picked.every((name) => name.startsWith("harp"))).toBe(true);
    for (const track of mine(result)) {
      expect((track as any).agentRecommendation.explanation[0]).toBe(DISCOVERY_EXPLANATION_VARIANTS.steered_toward);
    }
    expect(signalOf(await wholePool(sessionId), "harp1")).toMatchObject({ weight: 15 });
  });

  it("ignores actions that are neither a complete, a save nor a skip", async () => {
    const sessionId = await newSession();
    for (const action of ["accept", "replay", "unsave", "add_to_playlist"]) {
      await signal(sessionId, "drumplayed1", action);
    }
    expect(signalOf(await wholePool(sessionId), "drum1")).toBeUndefined();
  });

  it("halves an event after 4 further picks, from the session's pick notes", async () => {
    const sessionId = await newSession();
    for (const name of drumPlayed.slice(0, 3)) await signal(sessionId, name, "skip");
    // drum4 shares only the genre with the skipped tracks. No pick since: 3 x 5 = 15 points. 4 picks later: 7.5, rounded to 8. 8 later: 3.75, rounded to 4.
    expect(signalOf(await wholePool(sessionId), "drum4")).toMatchObject({ weight: -15 });
    await laterPicks(sessionId, 4);
    expect(signalOf(await wholePool(sessionId), "drum4")).toMatchObject({ weight: -8 });
    await laterPicks(sessionId, 4);
    expect(signalOf(await wholePool(sessionId), "drum4")).toMatchObject({ weight: -4 });
    // Decayed below the favour the genre started with, so the order is the established one again.
    const result = await select(sessionId);
    expect(names(mine(result).map((track) => track.id)).every((name) => name.startsWith("drum"))).toBe(true);
  });

  it("reads the session's rows from the policy context, newest first, with the listener's own only", async () => {
    const sessionId = await newSession();
    await signal(sessionId, "drumplayed1", "skip");
    await signal(sessionId, "harpplayed1", "save");
    await signal(sessionId, "harpplayed2", "accept");
    const steering = await policyContext.sessionSteering(LISTENER, sessionId, { performerCap: false });
    expect(steering.events.map((event) => event.direction).sort()).toEqual([-1, 1]);
    expect(steering.events.every((event) => event.picksAfter === 0)).toBe(true);
    expect(await policyContext.sessionSteering(OTHER, sessionId)).toEqual({ events: [] });
    expect(await policyContext.sessionSteering(LISTENER, undefined)).toEqual({ events: [] });
  });

  it("keeps the pick when the signals cannot be read", async () => {
    const sessionId = await newSession();
    for (const name of drumPlayed.slice(0, 3)) await signal(sessionId, name, "skip");
    const broken = Object.assign(new DiscoveryPolicyContextService(), {
      sessionSteering: async () => {
        throw new Error("database unavailable");
      },
    });
    const unsteered = new AgentSelectorService(tools, ranking, undefined, undefined, undefined, undefined, broken);
    const result = await unsteered.select({
      userId: LISTENER,
      sessionId,
      queries: [DRUM, HARP],
      recentTrackIds: played,
      learnedGenreWeights: { [DRUM]: 5 },
      limit: 4,
      useEmbeddings: false,
    });
    expect(names(mine(result).map((track) => track.id)).every((name) => name.startsWith("drum"))).toBe(true);
  });

  describe("inside a request tier", () => {
    const requestInput = (sessionId: string, extra: Record<string, unknown> = {}) => ({
      sessionId,
      requestScope: requestScopeFor({ sessionGenres: [DRUM] })!,
      queries: [DRUM],
      limit: 1,
      ...extra,
    });

    it("steers away from the credited artist of a skipped track, without leaving the request", async () => {
      const sessionId = await newSession();
      const baseline = await select(undefined, requestInput(sessionId));
      const first = mine(baseline)[0];
      expect(first).toBeDefined();
      // The session already played a track by every performer; skip the first pick's performer's.
      const firstNumber = (first.id.slice(TEST_PREFIX.length).match(/\d+/) as RegExpMatchArray)[0];
      await signal(sessionId, `drumplayed${firstNumber}`, "skip");

      const steered = await select(sessionId, requestInput(sessionId));
      const next = mine(steered)[0];
      expect(next.id).not.toBe(first.id);
      expect((next as any).requestTier).toBe("A");
      expect((next as any).agentRecommendation.explanation[0]).toBe(DISCOVERY_EXPLANATION_VARIANTS.steered_away);
      // The performer is named by the diversity cap's key, so the artist match is worth more than the genre alone.
      const all = await select(sessionId, requestInput(sessionId, { limit: 50 }));
      expect(signalOf(all, `drum${firstNumber}`)?.weight).toBeLessThan(signalOf(all, `drum${Number(firstNumber) % COUNT + 1}`)?.weight);
    });

    it("never moves a track across tiers, whatever the session did", async () => {
      const sessionId = await newSession();
      // The request is drum; padding with similar sounds is on and harp is the padding.
      for (const name of drumPlayed.slice(0, 3)) await signal(sessionId, name, "skip");
      for (const name of harpPlayed.slice(0, 3)) await signal(sessionId, name, "save");
      const result = await select(sessionId, {
        requestScope: requestScopeFor({ sessionGenres: [DRUM], fillSimilar: true })!,
        queries: [DRUM],
        tasteQueries: [HARP],
        limit: 10,
      });
      const order = names(mine(result).map((track) => track.id));
      expect(order.filter((name) => name.startsWith("drum"))).toHaveLength(COUNT);
      // Every on-request track comes before every padded one, though drum is at -15 and harp at +15.
      const lastDrum = Math.max(...order.map((name, index) => (name.startsWith("drum") ? index : -1)));
      const firstHarp = order.findIndex((name) => name.startsWith("harp"));
      expect(firstHarp).toBeGreaterThan(lastDrum);
      expect(signalOf(result, "drum1")).toMatchObject({ weight: -15 });
      expect(signalOf(result, "harp1")).toMatchObject({ weight: 15 });
    });
  });

  describe("Home", () => {
    it("ranks exactly as before: the session link of a signal changes nothing on Home", async () => {
      const home = new RecommendationsService(new EventBus(), ranking);
      const sessionId = await newSession();
      const rows = [
        await signal(sessionId, "drumplayed1", "skip"),
        await signal(sessionId, "harpplayed1", "save"),
        await signal(sessionId, "harpplayed2", "complete"),
      ];
      const homeRanking = async () => {
        await prisma.recommendationProfile.deleteMany({ where: { userId: LISTENER } });
        const result = await home.getRecommendations(LISTENER, 100);
        return result.items
          .filter((item) => item.id.startsWith(TEST_PREFIX))
          .map((item) => ({ id: item.id, score: item.score, reasons: item.reasons }));
      };
      const linked = await homeRanking();
      await prisma.agentSignal.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { sessionId: null } });
      const unlinked = await homeRanking();
      expect(linked.length).toBeGreaterThan(0);
      expect(linked).toEqual(unlinked);
      expect(JSON.stringify(linked)).not.toContain(DISCOVERY_EXPLANATION_VARIANTS.steered_away);
      expect(JSON.stringify(linked)).not.toContain("session_steering");
    });
  });
});
