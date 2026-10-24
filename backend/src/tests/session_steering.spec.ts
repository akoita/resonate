/**
 * In-session steering (#2247): the pure signal maths. A bounded (+-15),
 * decaying ranking term from the session's own skips, saves and finishes,
 * matched by genre family and credited artist, that works inside a request tier
 * and never moves a track across tiers. The end-to-end behaviour over real
 * AgentSignal rows is in agent_session_steering.integration.spec.ts.
 */
import { shapePickNote } from "../modules/agents/agent_pick_notes";
import { applyDiscoveryPolicy, discoveryArtistKey } from "../modules/recommendations/discovery-policy";
import { DISCOVERY_EXPLANATION_VARIANTS } from "../modules/recommendations/discovery-explanations";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import {
  buildSteeringEvents,
  SESSION_STEERING_ARTIST_POINTS,
  SESSION_STEERING_FAMILY_POINTS,
  SESSION_STEERING_MAX_EVENTS,
  SESSION_STEERING_MAX_POINTS,
  steeringArtistKey,
  steeringDecay,
  steeringFamilyIds,
  steeringPointsFor,
  type SessionSteering,
  type SteeringEvent,
} from "../modules/recommendations/session_steering";

const event = (overrides: Partial<SteeringEvent> = {}): SteeringEvent => ({
  direction: -1,
  picksAfter: 0,
  families: ["hip-hop"],
  artistKey: null,
  ...overrides,
});
const steering = (...events: SteeringEvent[]): SessionSteering => ({ events });
const rap = { families: ["hip-hop"], artistKey: "name:a" };
const pop = { families: ["pop"], artistKey: "name:b" };

describe("steeringDecay (#2247)", () => {
  it("halves after 4 further picks and keeps halving", () => {
    expect(steeringDecay(0)).toBe(1);
    expect(steeringDecay(4)).toBe(0.5);
    expect(steeringDecay(8)).toBe(0.25);
    expect(steeringDecay(2)).toBeGreaterThan(steeringDecay(3));
    expect(steeringDecay(2)).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("treats a bad age as fresh instead of throwing", () => {
    expect(steeringDecay(-3)).toBe(1);
    expect(steeringDecay(Number.NaN)).toBe(1);
  });
});

describe("steeringPointsFor (#2247)", () => {
  it("is zero with no events, and for a track nothing matches", () => {
    expect(steeringPointsFor(rap, undefined)).toBe(0);
    expect(steeringPointsFor(rap, steering())).toBe(0);
    expect(steeringPointsFor(pop, steering(event({ families: ["hip-hop"], artistKey: "name:a" })))).toBe(0);
  });

  it("matches by genre family and by credited artist, and adds both", () => {
    expect(steeringPointsFor({ families: ["hip-hop"], artistKey: "name:z" }, steering(event({ artistKey: "name:a" })))).toBe(
      -SESSION_STEERING_FAMILY_POINTS,
    );
    expect(steeringPointsFor({ families: ["pop"], artistKey: "name:a" }, steering(event({ artistKey: "name:a" })))).toBe(
      -SESSION_STEERING_ARTIST_POINTS,
    );
    expect(steeringPointsFor(rap, steering(event({ artistKey: "name:a" })))).toBe(
      -(SESSION_STEERING_FAMILY_POINTS + SESSION_STEERING_ARTIST_POINTS),
    );
  });

  it("is positive for completes and saves, negative for skips", () => {
    expect(steeringPointsFor(rap, steering(event({ direction: 1 })))).toBeGreaterThan(0);
    expect(steeringPointsFor(rap, steering(event({ direction: -1 })))).toBeLessThan(0);
  });

  it("is bounded to +-15 however many events pile up", () => {
    const skips = Array.from({ length: 30 }, () => event({ artistKey: "name:a" }));
    const saves = Array.from({ length: 30 }, () => event({ direction: 1, artistKey: "name:a" }));
    expect(steeringPointsFor(rap, steering(...skips))).toBe(-SESSION_STEERING_MAX_POINTS);
    expect(steeringPointsFor(rap, steering(...saves))).toBe(SESSION_STEERING_MAX_POINTS);
    expect(SESSION_STEERING_MAX_POINTS).toBe(15);
  });

  it("lets a save cancel a skip of the same family", () => {
    expect(steeringPointsFor(rap, steering(event(), event({ direction: 1 })))).toBe(0);
  });

  it("decays an event: half after 4 further picks, a quarter after 8", () => {
    const at = (picksAfter: number) => steeringPointsFor(rap, steering(event({ picksAfter, artistKey: "name:a" })));
    expect(at(0)).toBe(-10);
    expect(at(4)).toBe(-5);
    expect(at(8)).toBe(-3); // 2.5 rounds away from zero, as it does for a save
    expect(steeringPointsFor(rap, steering(event({ direction: 1, picksAfter: 8, artistKey: "name:a" })))).toBe(3);
    expect(at(40)).toBe(0);
  });

  it("never returns negative zero", () => {
    expect(Object.is(steeringPointsFor(rap, steering(event({ picksAfter: 60 }))), 0)).toBe(true);
  });
});

describe("steeringFamilyIds (#2247)", () => {
  it("reads the release genre and the stored descriptor families", () => {
    expect(steeringFamilyIds("French Rap")).toEqual(["hip-hop"]);
    expect(steeringFamilyIds("Rap", ["r&b-soul"])).toEqual(expect.arrayContaining(["hip-hop", "r&b-soul"]));
  });

  it("prefers narrow families to broad ones, so one Afrobeats skip does not lean on all of World", () => {
    const ids = steeringFamilyIds("Afrobeats");
    expect(ids).toContain("afrobeats");
    expect(ids).not.toContain("world");
    expect(ids).not.toContain("african");
    // Only broad families: they are kept.
    expect(steeringFamilyIds("World Music")).toEqual(["world"]);
  });

  it("falls back to the genre label when no family knows it, and to nothing without a genre", () => {
    expect(steeringFamilyIds("Zydeco Stomp")).toEqual(["genre:zydeco stomp"]);
    expect(steeringFamilyIds(null)).toEqual([]);
    expect(steeringFamilyIds(undefined, [])).toEqual([]);
  });
});

describe("steeringArtistKey (#2247)", () => {
  it("names a performer, and an uncredited track matches nobody else", () => {
    expect(steeringArtistKey("name:fabolous")).toBe("name:fabolous");
    expect(steeringArtistKey("track:t1")).toBeNull();
    expect(steeringArtistKey(undefined)).toBeNull();
  });
});

describe("buildSteeringEvents (#2247)", () => {
  const t = (minutes: number) => new Date(Date.UTC(2026, 9, 24, 12, minutes));
  const facts = new Map([
    ["t1", { families: ["hip-hop"], artistKey: "name:a" }],
    ["t2", { families: ["pop"], artistKey: "name:b" }],
    ["empty", { families: [], artistKey: null }],
  ]);

  it("maps completes and saves to + and skips to -, and ignores every other action", () => {
    const events = buildSteeringEvents({
      signals: [
        { trackId: "t1", action: "skip", createdAt: t(1) },
        { trackId: "t2", action: "complete", createdAt: t(2) },
        { trackId: "t2", action: "accept", createdAt: t(3) },
        { trackId: "t2", action: "replay", createdAt: t(3) },
        { trackId: "t2", action: "unsave", createdAt: t(3) },
        { trackId: "t2", action: "purchase", createdAt: t(3) },
      ],
      pickTimes: [],
      facts,
    });
    expect(events.map((entry) => [entry.direction, entry.artistKey])).toEqual([
      [1, "name:b"],
      [-1, "name:a"],
    ]);
  });

  it("counts a track once per direction: finished and saved is one +, the player skip next to Not this is one -", () => {
    const events = buildSteeringEvents({
      signals: [
        { trackId: "t1", action: "complete", createdAt: t(1) },
        { trackId: "t1", action: "save", createdAt: t(2) },
        { trackId: "t2", action: "skip", createdAt: t(3) },
        { trackId: "t2", action: "skip", createdAt: t(4) },
      ],
      pickTimes: [],
      facts,
    });
    expect(events).toHaveLength(2);
  });

  it("ages an event by the picks made after it", () => {
    const events = buildSteeringEvents({
      signals: [
        { trackId: "t1", action: "skip", createdAt: t(10) },
        { trackId: "t2", action: "complete", createdAt: t(30) },
      ],
      pickTimes: [t(0), t(5), t(20), t(25), t(40)],
      facts,
    });
    const byKey = new Map(events.map((entry) => [entry.artistKey, entry.picksAfter]));
    expect(byKey.get("name:a")).toBe(3);
    expect(byKey.get("name:b")).toBe(1);
  });

  it("leaves out a row whose track is unknown or has nothing to match on", () => {
    expect(
      buildSteeringEvents({
        signals: [
          { trackId: "gone", action: "skip", createdAt: t(1) },
          { trackId: "empty", action: "skip", createdAt: t(2) },
        ],
        pickTimes: [],
        facts,
      }),
    ).toEqual([]);
  });

  it("reads at most a bounded number of events, newest first", () => {
    const many = new Map<string, { families: string[]; artistKey: string | null }>();
    const signals = Array.from({ length: SESSION_STEERING_MAX_EVENTS + 10 }, (_, index) => {
      many.set(`m${index}`, { families: ["pop"], artistKey: null });
      return { trackId: `m${index}`, action: "skip", createdAt: t(index) };
    });
    const events = buildSteeringEvents({ signals, pickTimes: [], facts: many });
    expect(events).toHaveLength(SESSION_STEERING_MAX_EVENTS);
  });
});

describe("steering in the ranking core (#2247)", () => {
  const ranking = new DiscoveryRankingService();
  const track = (id: string, genre: string, artist: string) => ({
    id,
    title: id,
    artist,
    matchedQueries: ["Rap"],
    release: { genre, artistDisplayName: artist },
  });
  const context = { originalQueries: ["Rap"], expandedQueries: ["Rap"] };
  const skippedRap = steering(event({ families: ["hip-hop"], artistKey: "name:fabolous" }));

  it("demotes a track like the skipped ones, inside the same score field", async () => {
    const [plainOut, steeredOut] = await Promise.all([
      ranking.rank([track("rap", "Rap", "Nas"), track("pop", "Pop", "Dua")], context),
      ranking.rank([track("rap", "Rap", "Nas"), track("pop", "Pop", "Dua")], { ...context, sessionSteering: skippedRap }),
    ]);
    const score = (list: typeof plainOut, id: string) => list.find((entry) => entry.id === id)!.score;
    expect(score(steeredOut, "rap")).toBe(score(plainOut, "rap") - SESSION_STEERING_FAMILY_POINTS);
    expect(score(steeredOut, "pop")).toBe(score(plainOut, "pop"));
    const rapSignal = steeredOut.find((entry) => entry.id === "rap")!.signals.find((signal) => signal.label === "session_steering");
    expect(rapSignal).toMatchObject({ weight: -SESSION_STEERING_FAMILY_POINTS });
    expect(steeredOut.find((entry) => entry.id === "rap")!.steeringPoints).toBe(-SESSION_STEERING_FAMILY_POINTS);
    expect(steeredOut.find((entry) => entry.id === "pop")!.steeringPoints).toBeUndefined();
  });

  it("matches the credited artist across genres", async () => {
    const [out] = await ranking.rank([track("x", "Pop", "Fabolous")], {
      ...context,
      sessionSteering: steering(event({ families: ["hip-hop"], artistKey: discoveryArtistKey({ id: "x", release: { artistDisplayName: "Fabolous" } }) })),
    });
    expect(out.steeringPoints).toBe(-SESSION_STEERING_ARTIST_POINTS);
  });

  it("never words the steering by itself: the pick's explanation and reason are untouched", async () => {
    const plain = (await ranking.rank([track("rap", "Rap", "Nas")], context))[0];
    const steered = (await ranking.rank([track("rap", "Rap", "Nas")], { ...context, sessionSteering: skippedRap }))[0];
    expect(steered.explanation).toEqual(plain.explanation);
    expect(steered.reasonCode).toBe(plain.reasonCode);
  });

  it("leaves Home and the plain DJ exactly as they were: no steering in, no signal and the same scores out", async () => {
    const candidates = [track("rap", "Rap", "Nas"), track("pop", "Pop", "Dua")];
    const homeStyle = await ranking.rank(candidates, context);
    const emptySteering = await ranking.rank(candidates, { ...context, sessionSteering: { events: [] } });
    expect(emptySteering.map((entry) => [entry.id, entry.score])).toEqual(homeStyle.map((entry) => [entry.id, entry.score]));
    for (const entry of [...homeStyle, ...emptySteering]) {
      expect(entry.signals.some((signal) => signal.label === "session_steering")).toBe(false);
      expect(entry.steeringPoints).toBeUndefined();
    }
  });
});

describe("steering never moves a track across tiers (#2247)", () => {
  const ranking = new DiscoveryRankingService();
  const candidate = (id: string, genre: string, artist: string) => ({
    id,
    title: id,
    artist,
    matchedQueries: ["Rap"],
    release: { genre, artistDisplayName: artist, creditedArtistName: artist },
  });
  const context = { originalQueries: ["Rap"], expandedQueries: ["Rap"] };

  it("keeps tier A ahead of tier B and C at the full bound, in both directions", async () => {
    const candidates = [candidate("a-rap", "Rap", "Nas"), candidate("b-soul", "Soul", "Sade"), candidate("c-pop", "Pop", "Dua")];
    const tierById = new Map([["a-rap", "A" as const], ["b-soul", "B" as const], ["c-pop", "C" as const]]);
    const many = (direction: 1 | -1, families: string[]) =>
      steering(...Array.from({ length: 10 }, () => event({ direction, families, artistKey: null })));
    // Every track of the matching tier skipped, every off-request track saved: the maximum possible push.
    const pushedDown = await ranking.rank(candidates, { ...context, sessionSteering: many(-1, ["hip-hop"]) });
    const pushedUp = await ranking.rank(candidates, { ...context, sessionSteering: many(1, ["pop", "r&b-soul"]) });
    for (const ranked of [pushedDown, pushedUp]) {
      const result = applyDiscoveryPolicy(ranked, { limit: 3, requestFirst: { tierById, allowOffRequest: true } });
      expect(result.items.map((item) => item.id)).toEqual(["a-rap", "b-soul", "c-pop"]);
    }
    // And the term itself is what the bound says.
    expect(pushedDown.find((entry) => entry.id === "a-rap")!.steeringPoints).toBe(-SESSION_STEERING_MAX_POINTS);
    expect(pushedUp.find((entry) => entry.id === "c-pop")!.steeringPoints).toBe(SESSION_STEERING_MAX_POINTS);
  });

  it("reorders inside one tier", async () => {
    const candidates = [candidate("nas", "Rap", "Nas"), candidate("fab", "Rap", "Fabolous")];
    const tierById = new Map([["nas", "A" as const], ["fab", "A" as const]]);
    const skippedNas = steering(event({ artistKey: discoveryArtistKey({ id: "nas", release: { creditedArtistName: "Nas" } }), families: [] }));
    const plain = await ranking.rank(candidates, context);
    const steered = await ranking.rank(candidates, { ...context, sessionSteering: skippedNas });
    const order = (list: typeof plain) =>
      applyDiscoveryPolicy(list, { limit: 2, requestFirst: { tierById, allowOffRequest: false } }).items.map((item) => item.id);
    // Same field, so the order is the established one until the term moves Nas below.
    expect(order(steered)).toEqual(["fab", "nas"]);
    expect(order(plain)).toEqual(["nas", "fab"]);
  });
});

describe("steering sentences (#2247)", () => {
  it("are plain, in the shared vocabulary, and survive the persisted pick note", () => {
    expect(DISCOVERY_EXPLANATION_VARIANTS.steered_away).toBe("Less like the tracks you skipped");
    expect(DISCOVERY_EXPLANATION_VARIANTS.steered_toward).toBe("More like what you saved");
    const note = shapePickNote(
      {
        explanation: [
          DISCOVERY_EXPLANATION_VARIANTS.steered_away,
          "Selected vibe match",
          "A third sentence that is not stored",
        ],
        reasonCode: "taste_match",
      },
      "rules",
    );
    expect(note.explanation).toEqual(["Less like the tracks you skipped", "Selected vibe match"]);
    expect(shapePickNote({ explanation: [DISCOVERY_EXPLANATION_VARIANTS.steered_toward] }, "rules").explanation).toEqual([
      "More like what you saved",
    ]);
  });
});
