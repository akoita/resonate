import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, AgentNextPickResponse, AgentSession } from "../../lib/api";
import type { LocalTrack } from "../../lib/localLibrary";

// Effects never run in a server render, so record them and run them by hand.
// State and refs are kept in call-order slots so they survive across the
// repeated renders a test performs (a static render never re-renders on its own).
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
    useState: <T,>(initial: T | (() => T)) => {
      const index = slotIndex++;
      if (!(index in slots)) {
        slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      const setState = (next: T | ((previous: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (previous: T) => T)(slots[index] as T) : next;
      };
      return [slots[index] as T, setState] as const;
    },
    useRef: <T,>(initial: T) => {
      const index = slotIndex++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
  };
});

const hookState = {
  config: null as AgentConfig | null,
  isLoading: false,
  sessions: [] as AgentSession[],
  historyLoading: false,
};
const startSession = vi.fn(async () => ({ status: "started", sessionId: "s-1" }));
const stopSession = vi.fn(async () => ({ status: "stopped" }));
const updateConfig = vi.fn(async () => undefined);
const createConfig = vi.fn(async () => undefined);
const refetchConfig = vi.fn(async () => undefined);
const refetchHistory = vi.fn(async () => undefined);
const addToast = vi.fn();
const recordProductAnalytics = vi.fn(async () => undefined);

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: "tok", status: "authenticated" }) }));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast }) }));
vi.mock("../../lib/productAnalytics", () => ({
  recordProductAnalytics: (...args: unknown[]) => recordProductAnalytics(...(args as [])),
}));
vi.mock("../../hooks/useAgentConfig", () => ({
  useAgentConfig: () => ({
    config: hookState.config,
    isLoading: hookState.isLoading,
    createConfig,
    updateConfig,
    startSession,
    stopSession,
    refetch: refetchConfig,
  }),
}));
const playQueue = vi.fn(async () => undefined);
const saveTracksMetadata = vi.fn(async (tracks: unknown[]) => tracks);
const resolveDjQueue = vi.fn<(ids: string[], token?: string | null) => Promise<LocalTrack[]>>(async () => []);
const getAgentNextPick = vi.fn(async (): Promise<AgentNextPickResponse> => ({ status: "no_tracks" }));
vi.mock("../../lib/playerContext", () => ({ usePlayer: () => ({ playQueue }) }));
vi.mock("../../lib/localLibrary", () => ({
  saveTracksMetadata: (...args: unknown[]) => saveTracksMetadata(...(args as [unknown[]])),
}));
vi.mock("../../lib/agentDjPlayback", () => ({
  resolveDjQueue: (...args: unknown[]) => resolveDjQueue(...(args as [string[], string])),
}));
vi.mock("../../lib/api", () => ({
  getAgentNextPick: (...args: unknown[]) => getAgentNextPick(...(args as [])),
}));
vi.mock("../../hooks/useAgentEvents", () => ({ useAgentEvents: () => [] }));
vi.mock("../../hooks/useAgentHistory", () => ({
  useAgentHistory: () => ({
    sessions: hookState.sessions,
    isLoading: hookState.historyLoading,
    refetch: refetchHistory,
  }),
}));

// Capture the status card's toggle so the Start/Stop handler can be invoked.
const captured: { onToggle?: () => void; onPick?: () => Promise<void> } = {};
vi.mock("./AgentStatusCard", () => ({
  default: (props: { onToggle: () => void }) => {
    captured.onToggle = props.onToggle;
    return null;
  },
}));
vi.mock("./AgentActivityFeed", () => ({ default: () => null }));
vi.mock("./AgentNextPickCard", () => ({
  default: (props: { onPick: () => Promise<void> }) => {
    captured.onPick = props.onPick;
    return null;
  },
}));
vi.mock("./AgentHistoryCard", () => ({ default: () => null }));
vi.mock("./AgentSetupWizard", () => ({ default: () => null }));

import AgentSessionPanel from "./AgentSessionPanel";

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "agent-1",
    name: "Night DJ",
    vibes: ["Focus"],
    isActive: false,
    ...overrides,
  } as unknown as AgentConfig;
}

function track(id: string): LocalTrack {
  return { id, title: id, remoteUrl: `https://cdn.test/${id}.mp3` } as unknown as LocalTrack;
}

function session(id: string, trackIds: string[], overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    budgetCapUsd: 5,
    spentUsd: 0,
    startedAt: "2026-10-02T10:00:00.000Z",
    endedAt: null,
    licenses: trackIds.map((trackId) => ({ id: `lic-${trackId}`, trackId, type: "personal", priceUsd: 0 })),
    agentTransactions: [],
    ...overrides,
  } as unknown as AgentSession;
}

function render(refreshKey?: number) {
  effects.length = 0;
  slotIndex = 0;
  const html = renderToStaticMarkup(<AgentSessionPanel refreshKey={refreshKey} />);
  return html;
}

describe("AgentSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    slots.length = 0;
    resolveDjQueue.mockImplementation(async (ids: string[]) => ids.map(track));
    hookState.config = null;
    hookState.isLoading = false;
    hookState.sessions = [];
    hookState.historyLoading = false;
    captured.onToggle = undefined;
    captured.onPick = undefined;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("with no config shows the empty state and a Set up your DJ action", () => {
    const html = render();
    expect(html).toContain("Set up your DJ");
    expect(html).toContain("aid-empty");
    expect(html).not.toContain("Start Session");
  });

  it("shows a loader only while the first config load is in flight", () => {
    hookState.isLoading = true;
    expect(render()).toContain("Loading your DJ");

    // A background refetch must not blank an already-loaded panel.
    hookState.config = config();
    const html = render();
    expect(html).not.toContain("Loading your DJ");
    expect(html).toContain("Night DJ");
  });

  it("renders the command bar for an inactive DJ and starts a session", async () => {
    hookState.config = config({ isActive: false });
    const html = render();
    expect(html).toContain("Night DJ");
    expect(html).toContain("Inactive");
    expect(html).toContain("Start Session");
    // No ERC-8004 identity actions, no Crate Digger banner.
    expect(html).not.toContain("Portable Identity");
    expect(html).not.toContain("Crate Digger");

    await captured.onToggle?.();
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(stopSession).not.toHaveBeenCalled();
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.session_started",
      expect.objectContaining({ payload: expect.objectContaining({ surface: "home" }) }),
    );
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Session Started" }));
  });

  it("stops a live session", async () => {
    hookState.config = config({ isActive: true });
    const html = render();
    expect(html).toContain("Live");
    expect(html).toContain("Stop Session");

    await captured.onToggle?.();
    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(startSession).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Session Stopped" }));
  });

  it("refetches config and history when refreshKey bumps, not on first mount", () => {
    hookState.config = config();
    render(0);
    effects.forEach((run) => run());
    expect(refetchConfig).not.toHaveBeenCalled();
    expect(refetchHistory).not.toHaveBeenCalled();

    render(1);
    effects.forEach((run) => run());
    expect(refetchConfig).toHaveBeenCalledTimes(1);
    expect(refetchHistory).toHaveBeenCalledTimes(1);
  });

  it("links to Settings for DJ preferences", () => {
    hookState.config = config();
    expect(render()).toContain('href="/settings?section=dj"');
  });

  describe("DJ playback", () => {
    it("plays the picked track first when Next AI Pick succeeds", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      getAgentNextPick.mockResolvedValueOnce({
        status: "ok",
        track: { id: "t-main", title: "Main", artistId: "a-1" },
        tracks: [
          { trackId: "t-main", licenseType: "personal", priceUsd: 0 },
          { trackId: "t-extra", licenseType: "personal", priceUsd: 0 },
        ],
      });
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(resolveDjQueue).toHaveBeenCalledWith(["t-main", "t-main", "t-extra"], "tok");
      expect(playQueue).toHaveBeenCalledTimes(1);
      const [queue, startIndex] = playQueue.mock.calls[0] as unknown as [LocalTrack[], number];
      expect(queue[0].id).toBe("t-main");
      expect(startIndex).toBe(0);
      expect(saveTracksMetadata).toHaveBeenCalledWith(queue, "remote");
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "AI Pick Ready", message: expect.stringContaining("Playing Main") }),
      );
    });

    it("does not touch the player when Next AI Pick returns nothing", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(playQueue).not.toHaveBeenCalled();
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "No Pick Returned" }));
    });

    it("toasts when the DJ's picks cannot be played", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      getAgentNextPick.mockResolvedValueOnce({
        status: "ok",
        track: { id: "t-main", title: "Main", artistId: "a-1" },
      });
      playQueue.mockRejectedValueOnce(new Error("audio blocked"));
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", title: "Couldn't play the DJ's picks", message: "audio blocked" }),
      );
    });

    it("plays a started session's picks once when they appear in history", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.onToggle?.();
      expect(playQueue).not.toHaveBeenCalled();

      // No picks yet: nothing plays.
      hookState.sessions = [session("s-1", [])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(playQueue).not.toHaveBeenCalled();

      // The DJ's picks land; they play in their returned order.
      hookState.sessions = [session("s-1", ["t-1", "t-2"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(resolveDjQueue).toHaveBeenCalledWith(["t-1", "t-2"], "tok");
      expect(playQueue).toHaveBeenCalledTimes(1);

      // A later history refresh does not restart playback.
      hookState.sessions = [session("s-1", ["t-1", "t-2", "t-3"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(playQueue).toHaveBeenCalledTimes(1);
    });

    it("does not autoplay a session that was not started from this panel", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-external", ["t-1"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(playQueue).not.toHaveBeenCalled();
    });

    it("polls history while waiting, then gives up with a toast", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.onToggle?.();

      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(3000);
      expect(refetchHistory).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(42000);
      expect(refetchHistory.mock.calls.length).toBeGreaterThanOrEqual(14);
      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "The DJ found nothing to play yet" }),
      );
      expect(playQueue).not.toHaveBeenCalled();
    });

    it("stopping the session cancels the pending autoplay", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.onToggle?.();

      hookState.config = config({ isActive: true });
      render();
      await captured.onToggle?.();
      expect(stopSession).toHaveBeenCalledTimes(1);

      hookState.sessions = [session("s-1", ["t-1"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(playQueue).not.toHaveBeenCalled();
    });
  });
});
