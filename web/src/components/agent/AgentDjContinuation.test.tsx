import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentNextPickResponse } from "../../lib/api";
import type { DjSet } from "../../lib/agentDjSet";
import type { LocalTrack } from "../../lib/localLibrary";

// Effects never run in a server render, so record them and run them by hand.
// Refs live in call-order slots so they survive repeated renders.
const effects: Array<() => void | (() => void)> = [];
const slots: unknown[] = [];
let slotIndex = 0;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => {
      effects.push(fn);
    },
    useRef: <T,>(initial: T) => {
      const index = slotIndex++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
  };
});

const playerState = {
  queue: [] as LocalTrack[],
  currentIndex: -1,
  currentTrack: null as LocalTrack | null,
};
const addTracksToQueue = vi.fn((tracks: LocalTrack[]) => ({ queue: [], added: tracks, skipped: [] }));
const getAgentNextPick = vi.fn(async (): Promise<AgentNextPickResponse> => ({ status: "no_tracks" }));
const resolveDjQueue = vi.fn<(ids: string[], token?: string | null) => Promise<LocalTrack[]>>(async () => []);
const saveTracksMetadata = vi.fn(async (tracks: unknown[]) => tracks);
const authState = { token: "tok" as string | null };

// A tiny stand-in for the shared DJ set store.
let currentSet: DjSet | null = null;
const setDjSet = vi.fn((next: DjSet | null) => {
  currentSet = next;
});
const addDjSetTracks = vi.fn((ids: string[]) => {
  if (currentSet) currentSet = { ...currentSet, trackIds: [...currentSet.trackIds, ...ids] };
});

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: authState.token }) }));
vi.mock("../../lib/playerContext", () => ({
  usePlayer: () => ({ ...playerState, addTracksToQueue }),
}));
vi.mock("../../lib/api", () => ({
  getAgentNextPick: (...args: unknown[]) => getAgentNextPick(...(args as [])),
}));
vi.mock("../../lib/agentDjPlayback", () => ({
  resolveDjQueue: (...args: unknown[]) => resolveDjQueue(...(args as [string[], string])),
}));
vi.mock("../../lib/localLibrary", () => ({
  saveTracksMetadata: (...args: unknown[]) => saveTracksMetadata(...(args as [unknown[]])),
}));
vi.mock("../../lib/agentDjSet", () => ({
  useDjSet: () => currentSet,
  getDjSet: () => currentSet,
  setDjSet: (next: DjSet | null) => setDjSet(next),
  addDjSetTracks: (ids: string[]) => addDjSetTracks(ids),
}));

import AgentDjContinuation, { pickNewIds, shouldRefill } from "./AgentDjContinuation";

function track(id: string): LocalTrack {
  return { id, catalogTrackId: id, title: id, remoteUrl: `https://cdn.test/${id}.mp3` } as unknown as LocalTrack;
}

const PREFERENCES = { genres: ["Focus"], licenseType: "personal" as const };

function setPlayer(ids: string[], currentIndex: number) {
  playerState.queue = ids.map(track);
  playerState.currentIndex = currentIndex;
  playerState.currentTrack = currentIndex >= 0 ? playerState.queue[currentIndex] : null;
}

async function renderAndRun() {
  effects.length = 0;
  slotIndex = 0;
  renderToStaticMarkup(<AgentDjContinuation />);
  effects.forEach((run) => run());
  // Let the async refill settle.
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

describe("shouldRefill", () => {
  const set: DjSet = { sessionId: "s-1", preferences: {}, trackIds: ["a", "b", "c"] };
  const base = { set, hasToken: true, currentTrackId: "c", currentIndex: 2, queueLength: 3 };

  it("refills on the last and second-to-last DJ track", () => {
    expect(shouldRefill(base)).toBe(true);
    expect(shouldRefill({ ...base, currentTrackId: "b", currentIndex: 1 })).toBe(true);
  });

  it("does nothing earlier in the queue", () => {
    expect(shouldRefill({ ...base, currentTrackId: "a", currentIndex: 0 })).toBe(false);
    expect(shouldRefill({ ...base, currentTrackId: "c", currentIndex: 2, queueLength: 6 })).toBe(false);
  });

  it("does nothing without a set, token, or a DJ track playing", () => {
    expect(shouldRefill({ ...base, set: null })).toBe(false);
    expect(shouldRefill({ ...base, hasToken: false })).toBe(false);
    expect(shouldRefill({ ...base, currentTrackId: "someone-elses" })).toBe(false);
    expect(shouldRefill({ ...base, currentTrackId: undefined })).toBe(false);
    expect(shouldRefill({ ...base, currentIndex: -1 })).toBe(false);
  });
});

describe("pickNewIds", () => {
  it("drops queued, duplicate and empty ids, keeping order", () => {
    const queue = [track("a"), { id: "local-b", catalogTrackId: "b" } as unknown as LocalTrack];
    expect(pickNewIds(["a", "b", "c", undefined, "d", "c"], queue)).toEqual(["c", "d"]);
  });
});

describe("AgentDjContinuation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    slots.length = 0;
    authState.token = "tok";
    currentSet = { sessionId: "s-1", preferences: PREFERENCES, trackIds: ["a", "b", "c"] };
    setPlayer(["a", "b", "c"], 2);
    getAgentNextPick.mockResolvedValue({ status: "no_tracks" });
    resolveDjQueue.mockImplementation(async (ids: string[]) => ids.map(track));
    addTracksToQueue.mockImplementation((tracks: LocalTrack[]) => ({ queue: [], added: tracks, skipped: [] }));
  });

  it("renders nothing", () => {
    expect(renderToStaticMarkup(<AgentDjContinuation />)).toBe("");
  });

  it("appends the next picks when the last DJ track is playing", async () => {
    getAgentNextPick.mockResolvedValueOnce({
      status: "ok",
      track: { id: "d", title: "D", artistId: "x" },
      tracks: [
        { trackId: "d", licenseType: "personal", priceUsd: 0 },
        { trackId: "a", licenseType: "personal", priceUsd: 0 }, // already queued
        { trackId: "e", licenseType: "personal", priceUsd: 0 },
      ],
    });

    await renderAndRun();

    expect(getAgentNextPick).toHaveBeenCalledTimes(1);
    expect(getAgentNextPick).toHaveBeenCalledWith("tok", { sessionId: "s-1", preferences: PREFERENCES });
    expect(resolveDjQueue).toHaveBeenCalledWith(["d", "e"], "tok");
    expect(saveTracksMetadata).toHaveBeenCalledWith(expect.any(Array), "remote");
    expect(addTracksToQueue).toHaveBeenCalledTimes(1);
    expect((addTracksToQueue.mock.calls[0][0] as LocalTrack[]).map((t) => t.id)).toEqual(["d", "e"]);
    expect(addDjSetTracks).toHaveBeenCalledWith(["d", "e"]);
  });

  it("does not double-fetch on a re-render while the queue is unchanged", async () => {
    await renderAndRun();
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the current track is not a DJ track", async () => {
    currentSet = { sessionId: "s-1", preferences: PREFERENCES, trackIds: ["x", "y"] };
    await renderAndRun();
    expect(getAgentNextPick).not.toHaveBeenCalled();
  });

  it("does nothing when the player is not near the end of the queue", async () => {
    setPlayer(["a", "b", "c", "d", "e"], 0);
    currentSet = { sessionId: "s-1", preferences: PREFERENCES, trackIds: ["a", "b", "c", "d", "e"] };
    await renderAndRun();
    expect(getAgentNextPick).not.toHaveBeenCalled();
  });

  it("does nothing without a set or a signed-in user", async () => {
    currentSet = null;
    await renderAndRun();
    expect(getAgentNextPick).not.toHaveBeenCalled();

    currentSet = { sessionId: "s-1", preferences: PREFERENCES, trackIds: ["a", "b", "c"] };
    authState.token = null;
    await renderAndRun();
    expect(getAgentNextPick).not.toHaveBeenCalled();
  });

  it("clears the set when the session is no longer live", async () => {
    getAgentNextPick.mockResolvedValueOnce({ status: "session_inactive" });
    await renderAndRun();
    expect(setDjSet).toHaveBeenCalledWith(null);
    expect(addTracksToQueue).not.toHaveBeenCalled();
  });

  it("does not retry after the DJ has no more tracks", async () => {
    getAgentNextPick.mockResolvedValue({ status: "no_tracks" });
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);

    // The queue changes shape (so the length guard would allow a new request),
    // but the set is exhausted.
    setPlayer(["a", "b", "c", "z"], 2);
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);
    expect(addTracksToQueue).not.toHaveBeenCalled();
  });

  it("treats picks that are all already queued as exhausted", async () => {
    getAgentNextPick.mockResolvedValue({
      status: "ok",
      track: { id: "a", title: "A", artistId: "x" },
      tracks: [{ trackId: "b", licenseType: "personal", priceUsd: 0 }],
    });
    await renderAndRun();
    expect(resolveDjQueue).not.toHaveBeenCalled();
    expect(addTracksToQueue).not.toHaveBeenCalled();

    setPlayer(["a", "b", "c", "z"], 2);
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);
  });

  it("warns and stops retrying when the request fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getAgentNextPick.mockRejectedValue(new Error("offline"));
    await renderAndRun();
    expect(warn).toHaveBeenCalled();

    setPlayer(["a", "b", "c", "z"], 2);
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("can refill again once the queue has grown and the player nears the end again", async () => {
    getAgentNextPick.mockResolvedValue({
      status: "ok",
      track: { id: "d", title: "D", artistId: "x" },
    });
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(1);

    currentSet = { sessionId: "s-1", preferences: PREFERENCES, trackIds: ["a", "b", "c", "d"] };
    getAgentNextPick.mockResolvedValue({
      status: "ok",
      track: { id: "e", title: "E", artistId: "x" },
    });
    setPlayer(["a", "b", "c", "d"], 3);
    await renderAndRun();
    expect(getAgentNextPick).toHaveBeenCalledTimes(2);
  });
});
