import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNextPickResponse } from "../../lib/api";
import type { DjSet } from "../../lib/agentDjSet";
import type { LocalTrack } from "../../lib/localLibrary";

const { FakeApiError } = vi.hoisted(() => ({
  FakeApiError: class FakeApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
}));

const track = (id: string): LocalTrack =>
  ({ id, catalogTrackId: id, title: `Title ${id}`, artist: `Artist ${id}`, remoteUrl: `https://cdn.test/${id}.mp3` }) as unknown as LocalTrack;

const player = {
  queue: [] as LocalTrack[],
  currentIndex: 0,
  nextTrack: vi.fn(),
  removeFromQueue: vi.fn((index: number) => {
    player.queue = player.queue.filter((_, i) => i !== index);
  }),
  addTracksToQueue: vi.fn((tracks: LocalTrack[]) => {
    player.queue = [...player.queue, ...tracks];
    return { queue: player.queue, added: tracks, skipped: [] };
  }),
};
let currentSet: DjSet | null = null;
const getAgentNextPick = vi.fn<(...args: unknown[]) => Promise<AgentNextPickResponse>>(async () => ({ status: "no_tracks" }));
const recordAgentSignal = vi.fn<(...args: unknown[]) => Promise<{ status: string }>>(async () => ({ status: "recorded" }));
const recordProductAnalytics = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
const resolveDjQueue = vi.fn(async (ids: string[]) => ids.map(track));
const saveTracksMetadata = vi.fn(async (tracks: unknown[]) => tracks);

vi.mock("../../lib/playerContext", () => ({ usePlayer: () => player }));
vi.mock("../../lib/agentDjSet", () => ({
  getDjSet: () => currentSet,
  useDjSet: () => currentSet,
  replaceDjSetTracks: (remove: string[], add: string[], notes: DjSet["picks"] = {}) => {
    if (!currentSet) return;
    const kept = currentSet.trackIds.filter((id) => !remove.includes(id));
    currentSet = {
      ...currentSet,
      trackIds: [...kept, ...add.filter((id) => !kept.includes(id))],
      picks: { ...(currentSet.picks ?? {}), ...notes },
    };
  },
}));
vi.mock("../../lib/api", () => ({
  ApiRequestError: FakeApiError,
  getAgentNextPick: (...args: unknown[]) => getAgentNextPick(...args),
  recordAgentSignal: (...args: unknown[]) => recordAgentSignal(...args),
}));
vi.mock("../../lib/productAnalytics", () => ({
  recordProductAnalytics: (...args: unknown[]) => recordProductAnalytics(...args),
}));
vi.mock("../../lib/agentDjPlayback", () => ({
  resolveDjQueue: (ids: string[]) => resolveDjQueue(ids),
}));
vi.mock("../../lib/localLibrary", () => ({
  saveTracksMetadata: (tracks: unknown[]) => saveTracksMetadata(tracks),
}));
vi.mock("./AgentDjContinuation", () => ({
  pickNewIds: (ids: Array<string | null | undefined>, queue: readonly LocalTrack[]) => {
    const queued = new Set(queue.flatMap((entry) => [entry.id, entry.catalogTrackId ?? ""]));
    return Array.from(new Set(ids.filter((id): id is string => Boolean(id) && !queued.has(id as string))));
  },
}));

import { useDjUpNext } from "./useDjUpNext";

type Hook = ReturnType<typeof useDjUpNext>;
const buildPreferences = vi.fn(() => ({ genres: ["Soul"] }));
const onPicks = vi.fn();

function mount(sessionId: string | null = "s-1"): Hook {
  const seen: Hook[] = [];
  function Host({ onHook }: { onHook: (hook: Hook) => void }) {
    onHook(useDjUpNext({ token: "tok", sessionId, buildPreferences, surface: "home", intent: "Focus", intentName: "Neural Flow", onPicks }));
    return null;
  }
  renderToStaticMarkup(<Host onHook={(hook) => seen.push(hook)} />);
  return seen[0];
}

function setUp() {
  player.queue = ["played", "now", "n1", "n2", "n3"].map(track);
  player.currentIndex = 1;
  currentSet = {
    sessionId: "s-1",
    preferences: { genres: ["Soul"] },
    trackIds: ["played", "now", "n1", "n2", "n3"],
    picks: { n1: { reason: "Selected vibe match", source: "rules" } },
  };
}

function okPick(ids: string[], extra: Partial<AgentNextPickResponse> = {}): AgentNextPickResponse {
  return {
    status: "ok",
    track: { id: ids[0], title: ids[0], artistId: "a" },
    explanation: ["Sounds close to your taste"],
    tracks: ids.slice(1).map((trackId) => ({ trackId, licenseType: "personal" as const, priceUsd: 0, explanation: ["Nearby vibe match"] })),
    curatedBy: "llm",
    ...extra,
  };
}

const nextPickEvents = () =>
  recordProductAnalytics.mock.calls.filter((call) => call[1] === "agent.next_pick_requested");

const queueIds = () => player.queue.map((entry) => entry.id);

describe("useDjUpNext (#2243)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentNextPick.mockResolvedValue({ status: "no_tracks" });
    resolveDjQueue.mockImplementation(async (ids: string[]) => ids.map(track));
    setUp();
  });

  it("exposes the playing DJ track and the next picks with their reasons", () => {
    const hook = mount();
    expect(hook.view.now?.id).toBe("now");
    expect(hook.view.upNext.map((entry) => [entry.id, entry.reason])).toEqual([
      ["n1", "Selected vibe match"],
      ["n2", null],
      ["n3", null],
    ]);
  });

  it("has nothing to show without an open session", () => {
    expect(mount(null).view).toEqual({ now: null, upNext: [] });
  });

  it("Skip plays the next track through the player and reports ids only", async () => {
    await mount().skip();
    expect(player.nextTrack).toHaveBeenCalledTimes(1);
    expect(recordProductAnalytics).toHaveBeenCalledWith("tok", "agent.up_next_action", {
      source: "agent_up_next_card",
      subjectType: "agent_session",
      subjectId: "s-1",
      payload: { surface: "home", action: "skip", trackId: "now", intent: "Focus" },
    });
    expect(getAgentNextPick).not.toHaveBeenCalled();
    expect(nextPickEvents()).toHaveLength(0);
  });

  it("Not this writes the existing skip signal, removes the track, and asks the DJ to refill", async () => {
    getAgentNextPick.mockResolvedValueOnce(
      okPick(["r1", "r2"], { runtimeStatus: "approved", score: 42, rankerVariant: "v2", experimentKey: "exp-1" }),
    );
    const hook = mount();
    await hook.notThis(hook.view.upNext[1]);

    expect(recordAgentSignal).toHaveBeenCalledWith("tok", {
      trackId: "n2",
      action: "skip",
      sessionId: "s-1",
      metadata: { source: "ai_dj_up_next", agentSessionId: "s-1" },
    });
    expect(queueIds()).not.toContain("n2");
    expect(currentSet?.trackIds).not.toContain("n2");
    // The refill asks with the DJ's filters and no seed.
    expect(getAgentNextPick).toHaveBeenCalledWith("tok", { sessionId: "s-1", preferences: { genres: ["Soul"] } });
    expect(queueIds()).toEqual(["played", "now", "n1", "n3", "r1", "r2"]);
    expect(currentSet?.trackIds).toEqual(expect.arrayContaining(["r1", "r2"]));
    expect(currentSet?.picks?.r1).toEqual({ reason: "Sounds close to your taste", source: "ai" });
    expect(onPicks).toHaveBeenCalledTimes(1);
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.up_next_action",
      expect.objectContaining({ payload: expect.objectContaining({ action: "not_this", trackId: "n2" }) }),
    );
    // The DJ added picks from a next-pick response: the DJ-impression event is
    // sent with the shape the retired Next AI Pick button used (#2242 metrics).
    expect(recordProductAnalytics).toHaveBeenCalledWith("tok", "agent.next_pick_requested", {
      source: "agent_next_pick_card",
      subjectType: "agent_session",
      subjectId: "s-1",
      payload: {
        surface: "home",
        intent: "Focus",
        intentName: "Neural Flow",
        status: "ok",
        trackId: "r1",
        runtimeStatus: "approved",
        score: 42,
        rankerVariant: "v2",
        experimentKey: "exp-1",
      },
    });
    expect(nextPickEvents()).toHaveLength(1);
  });

  it("Not this never queues the rejected track again, even if the DJ returns it", async () => {
    getAgentNextPick.mockResolvedValueOnce(okPick(["n2", "r1"]));
    const hook = mount();
    await hook.notThis(hook.view.upNext[1]);
    expect(queueIds()).not.toContain("n2");
    expect(queueIds()).toContain("r1");
  });

  it("Not this on the playing track moves past it with the player", async () => {
    getAgentNextPick.mockResolvedValueOnce(okPick(["r1"]));
    const hook = mount();
    await hook.notThis(hook.view.now!);
    expect(recordAgentSignal).toHaveBeenCalledWith("tok", expect.objectContaining({ trackId: "now", action: "skip" }));
    expect(player.nextTrack).toHaveBeenCalledTimes(1);
    expect(player.removeFromQueue).not.toHaveBeenCalled();
    expect(queueIds()).toContain("r1");
  });

  it("More like this sends the track as the seed and swaps the other upcoming picks for its neighbours", async () => {
    getAgentNextPick.mockResolvedValueOnce(okPick(["m1", "m2"], { curatedBy: "rules" }));
    const hook = mount();
    await hook.moreLikeThis(hook.view.upNext[0]);

    expect(getAgentNextPick).toHaveBeenCalledWith("tok", {
      sessionId: "s-1",
      preferences: { genres: ["Soul"], seedTrackId: "n1" },
    });
    // The seed stays; the other upcoming DJ picks make room for its neighbours.
    expect(queueIds()).toEqual(["played", "now", "n1", "m1", "m2"]);
    // The seed is never stored with the set's preferences.
    expect(currentSet?.preferences).toEqual({ genres: ["Soul"] });
    expect(currentSet?.picks?.m1).toEqual({ reason: "Sounds close to your taste", source: "rules" });
    expect(recordAgentSignal).not.toHaveBeenCalled();
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.up_next_action",
      expect.objectContaining({ payload: expect.objectContaining({ action: "more_like_this", trackId: "n1", added: 2 }) }),
    );
    expect(nextPickEvents()).toHaveLength(1);
    expect(nextPickEvents()[0][2]).toMatchObject({ payload: { status: "ok", trackId: "m1" } });
  });

  it("More like this leaves the queue alone and says so when nothing closer is found", async () => {
    const hook = mount();
    await hook.moreLikeThis(hook.view.upNext[0]);
    expect(queueIds()).toEqual(["played", "now", "n1", "n2", "n3"]);
    expect(player.removeFromQueue).not.toHaveBeenCalled();
    // Nothing was added to the queue, so no DJ pick is counted.
    expect(nextPickEvents()).toHaveLength(0);
  });

  it("keeps the queue playing on a rate limit", async () => {
    getAgentNextPick.mockRejectedValueOnce(new FakeApiError("too quick", 429));
    const hook = mount();
    await hook.moreLikeThis(hook.view.upNext[0]);
    expect(queueIds()).toEqual(["played", "now", "n1", "n2", "n3"]);
    expect(player.nextTrack).not.toHaveBeenCalled();
  });

  it("ignores a second action while one is in flight", async () => {
    let release: (value: AgentNextPickResponse) => void = () => undefined;
    getAgentNextPick.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const hook = mount();
    const first = hook.moreLikeThis(hook.view.upNext[0]);
    await hook.moreLikeThis(hook.view.upNext[1]);
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);
    release({ status: "no_tracks" });
    await first;
  });
});
