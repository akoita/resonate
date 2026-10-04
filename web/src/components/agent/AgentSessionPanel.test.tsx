import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentConfig,
  AgentNextPickResponse,
  AgentSession,
  AgentSessionRequestParse,
  ListeningLane,
} from "../../lib/api";
import type { AgentEvent } from "../../hooks/useAgentEvents";
import type { DjSet } from "../../lib/agentDjSet";
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
  events: [] as AgentEvent[],
  queue: [] as Array<{ id: string; catalogTrackId?: string }>,
  currentIndex: 0,
  djSet: null as DjSet | null,
};
const startSession = vi.fn(async () => ({ status: "started", sessionId: "s-1" }));
const stopSession = vi.fn(async () => ({ status: "stopped" }));
const updateConfig = vi.fn(async () => undefined);
const createConfig = vi.fn(async () => undefined);
const refetchConfig = vi.fn(async () => undefined);
const refetchHistory = vi.fn(async () => undefined);
const addToast = vi.fn();
const recordProductAnalytics = vi.fn(async () => undefined);
const myMixLane: ListeningLane = {
  id: "lane_0123456789abcdef0123456789abcdef",
  label: "Soul · Warm",
  genreWeights: { Soul: 0.8 },
  moodWeights: { Warm: 0.7 },
  strength: 0.9,
  contexts: { "evening:weekday": 0.8 },
  energyBand: "medium",
  hidden: false,
};
const getTasteMemory = vi.fn(async (): Promise<{ summary: { listeningLanes?: ListeningLane[] } }> => ({
  summary: { listeningLanes: [myMixLane] },
}));
const getAgentMixVocabulary = vi.fn(async () => ({ genres: ["Dancehall", "Soul"], moods: ["Warm", "Zen"] }));
const getAgentMixCoverage = vi.fn(async () => ({ mixCoverage: { lanes: [] } }));
const applyTasteEdits = vi.fn(async () => ({ edits: { appliedCount: 0, ignoredCount: 0 } }));

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
const removeFromQueue = vi.fn();
const addTracksToQueue = vi.fn((tracks: LocalTrack[]) => ({ added: tracks, skipped: [] as LocalTrack[] }));
const parseAgentSessionRequest = vi.fn<(token: string, text: string) => Promise<AgentSessionRequestParse>>(
  async () => ({
    request: { genres: [], moods: [], energy: null, bpm: null },
    unparsed: [],
    ignored: [],
    strategy: "deterministic",
  }),
);
vi.mock("../../lib/playerContext", () => ({
  usePlayer: () => ({
    playQueue,
    removeFromQueue,
    addTracksToQueue,
    queue: hookState.queue,
    currentIndex: hookState.currentIndex,
  }),
}));
vi.mock("../../lib/localLibrary", () => ({
  saveTracksMetadata: (...args: unknown[]) => saveTracksMetadata(...(args as [unknown[]])),
}));
const setDjSet = vi.fn();
vi.mock("../../lib/agentDjSet", () => ({
  setDjSet: (...args: unknown[]) => setDjSet(...args),
  getDjSet: () => hookState.djSet,
}));
vi.mock("../../lib/agentDjPlayback", () => ({
  resolveDjQueue: (...args: unknown[]) => resolveDjQueue(...(args as [string[], string])),
}));
vi.mock("../../lib/api", () => ({
  applyTasteEdits: (...args: unknown[]) => applyTasteEdits(...(args as [])),
  getAgentMixCoverage: (...args: unknown[]) => getAgentMixCoverage(...(args as [])),
  getAgentMixVocabulary: (...args: unknown[]) => getAgentMixVocabulary(...(args as [])),
  getAgentNextPick: (...args: unknown[]) => getAgentNextPick(...(args as [])),
  parseAgentSessionRequest: (...args: unknown[]) => parseAgentSessionRequest(...(args as [string, string])),
  getTasteMemory: (...args: unknown[]) => getTasteMemory(...(args as [])),
}));
vi.mock("../../hooks/useAgentEvents", () => ({ useAgentEvents: () => hookState.events }));
vi.mock("../../hooks/useAgentHistory", () => ({
  useAgentHistory: () => ({
    sessions: hookState.sessions,
    isLoading: hookState.historyLoading,
    refetch: refetchHistory,
  }),
}));

// Capture the status card's toggle so the Start/Stop handler can be invoked.
const captured: {
  onToggle?: () => void;
  onPick?: () => Promise<void>;
  pick?: AgentNextPickResponse | null;
  prompt?: PromptProps;
} = {};
vi.mock("./AgentStatusCard", () => ({
  default: (props: { onToggle: () => void }) => {
    captured.onToggle = props.onToggle;
    return null;
  },
}));
vi.mock("./AgentActivityFeed", () => ({ default: () => null }));
vi.mock("./AgentNextPickCard", () => ({
  default: (props: { onPick: () => Promise<void>; pick: AgentNextPickResponse | null }) => {
    captured.onPick = props.onPick;
    captured.pick = props.pick;
    return null;
  },
}));
vi.mock("./AgentSessionPrompt", () => ({
  default: (props: PromptProps) => {
    captured.prompt = props;
    return null;
  },
}));
vi.mock("./AgentHistoryCard", () => ({ default: () => null }));
vi.mock("./AgentSetupWizard", () => ({ default: () => null }));

import AgentSessionPanel, { buildSessionPreferences, toIntentPreferences } from "./AgentSessionPanel";
import { SESSION_PRESETS } from "./AgentSessionPresets";
import { requestFromPreset } from "../../lib/agentSessionRequest";
import type AgentSessionPrompt from "./AgentSessionPrompt";

type PromptProps = React.ComponentProps<typeof AgentSessionPrompt>;

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
    captured.pick = null;
    captured.prompt = undefined;
    hookState.events = [];
    hookState.queue = [];
    hookState.currentIndex = 0;
    hookState.djSet = null;
    addTracksToQueue.mockImplementation((tracks: LocalTrack[]) => ({ added: tracks, skipped: [] }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function loadMyMixCatalog() {
    render();
    effects.forEach((run) => run());
    await Promise.resolve();
    await Promise.resolve();
    render();
    effects.forEach((run) => run());
  }

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

  it("starts a preset exactly as before, plus its request, without overwriting saved vibes (#2036)", async () => {
    hookState.config = config({ isActive: false, vibes: ["Jazz"] });
    render();
    const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype");
    expect(preset).toBeDefined();

    captured.prompt?.onSelectPreset(preset!);
    render();
    expect(captured.prompt?.activePresetIntent).toBe("Hype");
    expect(captured.prompt?.request).toEqual(requestFromPreset(preset!));
    // A preset stands for known filters: nothing is parsed.
    await vi.advanceTimersByTimeAsync(2000);
    expect(parseAgentSessionRequest).not.toHaveBeenCalled();

    await captured.onToggle?.();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledTimes(1);
    const [input] = startSession.mock.calls[0] as unknown as [{ preferences: Record<string, unknown> }];
    expect(input.preferences).toEqual({ ...toIntentPreferences(preset!), request: requestFromPreset(preset!) });
    expect(input.preferences).toEqual(
      expect.objectContaining({
        genres: preset!.searchVibes,
        mood: "Hype",
        energy: "high",
        sessionIntent: "Hype",
      }),
    );
    expect(input.preferences).not.toHaveProperty("licenseType");
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.intent_selected",
      expect.objectContaining({ payload: expect.objectContaining({ intent: "Hype" }) }),
    );
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.session_started",
      expect.objectContaining({
        payload: expect.objectContaining({
          startedFrom: "preset",
          intent: "Hype",
          requestFilterKeys: ["genres", "moods", "energy"],
          unparsedCount: 0,
          ignoredKeys: [],
        }),
      }),
    );
  });

  it("starts a plain session with no preferences when nothing was typed or chosen", async () => {
    hookState.config = config({ isActive: false });
    render();
    await captured.onToggle?.();
    expect(startSession).toHaveBeenCalledWith(undefined);
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.session_started",
      expect.objectContaining({
        source: "agent_command_bar",
        payload: expect.objectContaining({ startedFrom: "plain", requestFilterKeys: [] }),
      }),
    );
  });

  it("starts My Mix with coarse session preferences and does not auto-save taste edits", async () => {
    hookState.config = config({ isActive: false });
    await loadMyMixCatalog();
    expect(captured.prompt?.myMix?.lanes).toEqual([myMixLane]);

    captured.prompt?.myMix?.onSelect();
    render();
    expect(captured.prompt?.myMix?.preferences).toMatchObject({ context: expect.any(String) });
    expect(captured.prompt?.myMix?.preferences).not.toHaveProperty("lanes");
    await captured.onToggle?.();

    const [input] = startSession.mock.calls[0] as unknown as [{ preferences: { myMix: Record<string, unknown> } }];
    expect(input.preferences.myMix).toMatchObject({ context: expect.any(String) });
    expect(input.preferences.myMix).not.toHaveProperty("laneLabel");
    expect(applyTasteEdits).not.toHaveBeenCalled();
    expect(JSON.stringify(recordProductAnalytics.mock.calls)).not.toContain(myMixLane.id);
  });

  it("saves only when explicitly requested and persists additions plus boosted lane terms", async () => {
    hookState.config = config({ isActive: false });
    await loadMyMixCatalog();
    captured.prompt?.myMix?.onSelect();
    render();
    captured.prompt?.myMix?.onChange({
      context: "evening:weekday",
      lanes: [{ id: myMixLane.id, boost: true }],
      additions: [{ genre: "Dancehall" }],
    });
    render();

    expect(applyTasteEdits).not.toHaveBeenCalled();
    await captured.prompt?.myMix?.onSave();

    expect(applyTasteEdits).toHaveBeenCalledWith("tok", [
      { signalType: "genre", value: "Dancehall", action: "boosted" },
      { signalType: "genre", value: "Soul", action: "boosted" },
      { signalType: "mood", value: "Warm", action: "boosted" },
    ]);
    expect(captured.prompt?.myMix?.preferences?.additions).toEqual([{ genre: "Dancehall" }]);
  });

  describe("typing what the session is for", () => {
    const SENTENCE = "Warm deep house around 122 BPM for cooking, in A minor under $5";
    const parsed: AgentSessionRequestParse = {
      request: { genres: ["deep house"], moods: ["warm"], energy: null, bpm: { min: 120, max: 125 } },
      unparsed: ["for cooking"],
      ignored: ["keys", "maxTotalUsd"],
      strategy: "deterministic",
    };

    function everythingSent(): string {
      return JSON.stringify({
        start: startSession.mock.calls,
        analytics: recordProductAnalytics.mock.calls,
        djSet: setDjSet.mock.calls,
        next: getAgentNextPick.mock.calls,
      });
    }

    it("reads the sentence after a pause and shows the filters", async () => {
      hookState.config = config({ isActive: false });
      parseAgentSessionRequest.mockResolvedValueOnce(parsed);
      render();

      captured.prompt?.onTextChange(SENTENCE);
      render();
      expect(captured.prompt?.isParsing).toBe(true);
      expect(parseAgentSessionRequest).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      expect(parseAgentSessionRequest).toHaveBeenCalledWith("tok", SENTENCE);
      render();
      expect(captured.prompt?.isParsing).toBe(false);
      expect(captured.prompt?.request).toEqual(parsed.request);
      expect(captured.prompt?.unparsed).toEqual(["for cooking"]);
      expect(captured.prompt?.ignored).toEqual(["keys", "maxTotalUsd"]);
      expect(captured.prompt?.activePresetIntent).toBeNull();
    });

    it("starts from the filters and never sends or records the sentence", async () => {
      hookState.config = config({ isActive: false });
      parseAgentSessionRequest.mockResolvedValueOnce(parsed);
      render();
      captured.prompt?.onTextChange(SENTENCE);
      render();

      // Still reading: starting now would ignore the sentence.
      await captured.onToggle?.();
      expect(startSession).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      render();
      await captured.onToggle?.();

      expect(startSession).toHaveBeenCalledWith({
        preferences: {
          request: parsed.request,
          genres: ["deep house"],
          mood: "warm",
          energy: undefined,
          source: "agent_session_prompt",
        },
      });
      expect(recordProductAnalytics).toHaveBeenCalledWith(
        "tok",
        "agent.session_started",
        expect.objectContaining({
          source: "agent_session_prompt",
          payload: expect.objectContaining({
            startedFrom: "prompt",
            requestFilterKeys: ["genres", "moods", "bpm"],
            unparsedCount: 1,
            ignoredKeys: ["keys", "maxTotalUsd"],
          }),
        }),
      );

      // The first picks arrive and the DJ set is recorded.
      hookState.sessions = [session("s-1", ["t-1"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(setDjSet).toHaveBeenCalledTimes(1);
      expect(setDjSet.mock.calls[0][0].preferences.request).toEqual(parsed.request);

      for (const fragment of ["cooking", "122", "A minor", "$5", SENTENCE]) {
        expect(everythingSent()).not.toContain(fragment);
      }
    });

    it("ignores a stale parse and keeps the previous chips when reading fails", async () => {
      hookState.config = config({ isActive: false });
      let releaseFirst: (value: AgentSessionRequestParse) => void = () => undefined;
      parseAgentSessionRequest.mockImplementationOnce(
        () => new Promise<AgentSessionRequestParse>((resolve) => (releaseFirst = resolve)),
      );
      parseAgentSessionRequest.mockResolvedValueOnce({
        ...parsed,
        request: { ...parsed.request, genres: ["techno"] },
      });
      render();

      captured.prompt?.onTextChange("deep house");
      render();
      await vi.advanceTimersByTimeAsync(600);
      captured.prompt?.onTextChange("techno");
      render();
      await vi.advanceTimersByTimeAsync(600);
      releaseFirst(parsed);
      await vi.advanceTimersByTimeAsync(0);
      render();
      expect(captured.prompt?.request?.genres).toEqual(["techno"]);

      parseAgentSessionRequest.mockRejectedValueOnce(new Error("boom"));
      captured.prompt?.onTextChange("techno but faster");
      render();
      await vi.advanceTimersByTimeAsync(600);
      render();
      expect(captured.prompt?.request?.genres).toEqual(["techno"]);
      expect(captured.prompt?.parseError).toMatch(/Couldn't read that/);
      expect(captured.prompt?.parseError).not.toContain("techno");
      expect(captured.prompt?.isParsing).toBe(false);
    });

    it("clears the filters when the text is emptied, which starts a plain session", async () => {
      hookState.config = config({ isActive: false });
      parseAgentSessionRequest.mockResolvedValueOnce(parsed);
      render();
      captured.prompt?.onTextChange("deep house");
      render();
      await vi.advanceTimersByTimeAsync(600);
      render();
      expect(captured.prompt?.request).not.toBeNull();

      captured.prompt?.onTextChange("   ");
      render();
      // An empty request (not null), so a live session's next picks drop the old filters.
      expect(captured.prompt?.request).toEqual({ genres: [], moods: [], energy: null, bpm: null });
      await captured.onToggle?.();
      expect(startSession).toHaveBeenCalledWith(undefined);
    });

    it("editing a chip makes the filters the listener's own and drops the preset", async () => {
      hookState.config = config({ isActive: false });
      render();
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      captured.prompt?.onSelectPreset(preset);
      render();
      captured.prompt?.onRemoveChip("energy");
      render();
      expect(captured.prompt?.activePresetIntent).toBeNull();
      expect(captured.prompt?.request?.energy).toBeNull();

      captured.prompt?.onEnergyChange("low");
      render();
      expect(captured.prompt?.request?.energy).toBe("low");

      await captured.onToggle?.();
      const [input] = startSession.mock.calls[0] as unknown as [{ preferences: Record<string, unknown> }];
      expect(input.preferences).toEqual(
        expect.objectContaining({
          source: "agent_session_prompt",
          genres: preset.searchVibes,
          mood: "Hype",
          energy: "low",
        }),
      );
      expect(input.preferences).not.toHaveProperty("sessionIntent");
    });
  });

  describe("re-planning a live session when a filter is edited", () => {
    function liveSet(): DjSet {
      return { sessionId: "s-open", preferences: {}, trackIds: ["a", "b", "c"] };
    }

    function setUpLiveSet() {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      hookState.djSet = liveSet();
      hookState.queue = [{ id: "a" }, { id: "b" }, { id: "local-c", catalogTrackId: "c" }, { id: "mine" }];
      hookState.currentIndex = 0;
    }

    function pickResponse(ids: string[], extra: Partial<AgentNextPickResponse> = {}): AgentNextPickResponse {
      return {
        status: "ok",
        track: { id: ids[0], title: ids[0], artistId: "a-1" },
        tracks: ids.slice(1).map((trackId) => ({ trackId, licenseType: "personal", priceUsd: 0 })),
        ...extra,
      };
    }

    async function editAndRender(edit: () => void) {
      edit();
      render();
      effects.forEach((run) => run());
    }

    it("swaps the DJ's upcoming picks for ones that follow the edited filters", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:EDM"));

      getAgentNextPick.mockResolvedValueOnce(
        pickResponse(["n1", "n2"], { requestCoverage: { picks: 2, gaps: [{ filter: "energy", matched: 1 }] } }),
      );
      await vi.advanceTimersByTimeAsync(800);
      await vi.advanceTimersByTimeAsync(0);

      expect(getAgentNextPick).toHaveBeenCalledTimes(1);
      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [
        string,
        { sessionId: string; preferences: { request: { genres: string[] }; source: string } },
      ];
      expect(body.sessionId).toBe("s-open");
      expect(body.preferences.request.genres).toEqual(["Trap", "Drum & Bass"]);
      expect(body.preferences.source).toBe("agent_session_prompt");

      // Upcoming DJ picks (indices 1 and 2) go, highest first; the listener's own track and the current one stay.
      expect(removeFromQueue.mock.calls.map(([index]) => index)).toEqual([2, 1]);
      expect(resolveDjQueue).toHaveBeenCalledWith(["n1", "n2"], "tok");
      expect(addTracksToQueue).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenCalledWith({
        sessionId: "s-open",
        preferences: body.preferences,
        trackIds: ["a", "n1", "n2"],
      });
      expect(playQueue).not.toHaveBeenCalled();

      render();
      expect(captured.prompt?.coverage).toEqual({ picks: 2, gaps: [{ filter: "energy", matched: 1 }] });
    });

    it("re-plans once for rapid chip removals", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await vi.advanceTimersByTimeAsync(300);
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:EDM"));
      await vi.advanceTimersByTimeAsync(300);
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:Drum & Bass"));
      await vi.advanceTimersByTimeAsync(300);
      expect(getAgentNextPick).not.toHaveBeenCalled();

      getAgentNextPick.mockResolvedValueOnce(pickResponse(["n1"]));
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);
      expect(getAgentNextPick).toHaveBeenCalledTimes(1);
      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [string, { preferences: { request: { genres: string[] } } }];
      expect(body.preferences.request.genres).toEqual(["Trap"]);
    });

    it("keeps the upcoming queue when the DJ finds nothing for the new filters", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:EDM"));

      getAgentNextPick.mockResolvedValueOnce({ status: "no_tracks" });
      await vi.advanceTimersByTimeAsync(800);
      await vi.advanceTimersByTimeAsync(0);

      expect(removeFromQueue).not.toHaveBeenCalled();
      expect(addTracksToQueue).not.toHaveBeenCalled();
      expect(setDjSet).toHaveBeenCalledWith({
        ...liveSet(),
        preferences: expect.objectContaining({ source: "agent_session_prompt" }),
      });
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "No new picks for those filters" }));
    });

    it("ignores an in-flight replan as soon as a newer My Mix edit arrives", async () => {
      setUpLiveSet();
      await loadMyMixCatalog();
      captured.prompt?.myMix?.onSelect();
      render();
      effects.forEach((run) => run());
      captured.prompt?.myMix?.onChange({ context: "evening:weekday", lanes: [] });
      render();
      effects.forEach((run) => run());

      let resolvePick: (value: AgentNextPickResponse) => void = () => undefined;
      getAgentNextPick.mockImplementationOnce(() => new Promise((resolve) => { resolvePick = resolve; }));
      await vi.advanceTimersByTimeAsync(800);
      expect(getAgentNextPick).toHaveBeenCalledTimes(1);

      captured.prompt?.myMix?.onChange({
        context: "evening:weekday",
        lanes: [{ id: myMixLane.id, boost: true }],
      });
      render();
      effects.forEach((run) => run());
      resolvePick(pickResponse(["stale-1", "stale-2"]));
      await Promise.resolve();
      await Promise.resolve();

      expect(removeFromQueue).not.toHaveBeenCalled();
      expect(addTracksToQueue).not.toHaveBeenCalled();
      expect(setDjSet).not.toHaveBeenCalled();
    });

    it("ignores in-flight manual picks after a My Mix edit or session change", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      await loadMyMixCatalog();
      captured.prompt?.myMix?.onSelect();
      render();
      effects.forEach((run) => run());

      let resolvePick: (value: AgentNextPickResponse) => void = () => undefined;
      getAgentNextPick.mockImplementationOnce(() => new Promise((resolve) => { resolvePick = resolve; }));
      const pendingPick = captured.onPick?.();
      expect(getAgentNextPick).toHaveBeenCalledTimes(1);

      captured.prompt?.myMix?.onChange({ context: "evening:weekday", lanes: [] });
      render();
      effects.forEach((run) => run());
      resolvePick(pickResponse(["stale-manual-pick"]));
      await pendingPick;
      render();

      expect(captured.pick).toBeNull();
      expect(playQueue).not.toHaveBeenCalled();
      expect(addToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "AI Pick Ready" }));
      expect(recordProductAnalytics).not.toHaveBeenCalledWith(
        "tok",
        "agent.next_pick_requested",
        expect.anything(),
      );

      let resolveSessionPick: (value: AgentNextPickResponse) => void = () => undefined;
      getAgentNextPick.mockImplementationOnce(() => new Promise((resolve) => { resolveSessionPick = resolve; }));
      const pendingSessionPick = captured.onPick?.();
      hookState.sessions = [session("s-new", [])];
      render();
      effects.forEach((run) => run());
      resolveSessionPick(pickResponse(["stale-session-pick"]));
      await pendingSessionPick;
      render();

      expect(getAgentNextPick).toHaveBeenCalledTimes(2);
      expect(captured.pick).toBeNull();
      expect(playQueue).not.toHaveBeenCalled();
    });

    it("clears remembered My Mix preferences when the listener switches to a regular preset", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      await loadMyMixCatalog();
      captured.prompt?.myMix?.onSelect();
      render();
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      captured.prompt?.onSelectPreset(preset);
      render();

      getAgentNextPick.mockResolvedValueOnce({ status: "no_tracks" });
      await captured.onPick?.();

      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [string, { preferences: { myMix?: unknown } }];
      expect(body.preferences).toHaveProperty("myMix", null);
    });

    it("only updates local state when no DJ set is live yet", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:EDM"));
      await vi.advanceTimersByTimeAsync(800);
      await vi.advanceTimersByTimeAsync(0);
      expect(getAgentNextPick).not.toHaveBeenCalled();

      // The next pick follows the edited filters.
      getAgentNextPick.mockResolvedValueOnce({ status: "no_tracks" });
      await captured.onPick?.();
      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [string, { preferences: { request: { genres: string[] } } }];
      expect(body.preferences.request.genres).toEqual(["Trap", "Drum & Bass"]);
    });

    it("the Update session action re-plans immediately", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      getAgentNextPick.mockResolvedValueOnce(pickResponse(["n1"]));
      await captured.prompt?.onSubmit();
      expect(getAgentNextPick).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenCalled();
    });

    it("stopping the session cancels a pending re-plan", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await captured.onToggle?.();
      await vi.advanceTimersByTimeAsync(2000);
      expect(getAgentNextPick).not.toHaveBeenCalled();
    });
  });

  describe("coverage", () => {
    it("shows the coverage of the newest live decision for the open session", () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      const coverage = { picks: 5, gaps: [{ filter: "bpm" as const, matched: 1 }] };
      hookState.events = [
        { id: "e2", type: "agent.selection", sessionId: "s-open", message: "", timestamp: "", icon: "" },
        { id: "e1", type: "agent.decision_made", sessionId: "other", message: "", timestamp: "", icon: "", coverage: { picks: 3, gaps: [] } },
        { id: "e0", type: "agent.decision_made", sessionId: "s-open", message: "", timestamp: "", icon: "", coverage },
      ];
      render();
      expect(captured.prompt?.coverage).toEqual(coverage);
    });

    it("hides coverage when no session is live", () => {
      hookState.config = config({ isActive: false });
      hookState.events = [
        { id: "e0", type: "agent.decision_made", sessionId: "s-open", message: "", timestamp: "", icon: "", coverage: { picks: 5, gaps: [] } },
      ];
      render();
      expect(captured.prompt?.coverage).toBeNull();
    });
  });

  describe("buildSessionPreferences", () => {
    it("returns nothing to steer without filters or a preset", () => {
      expect(buildSessionPreferences({ activePreset: null, request: null })).toBeUndefined();
      expect(
        buildSessionPreferences({
          activePreset: null,
          request: { genres: [], moods: [], energy: null, bpm: null },
        }),
      ).toBeUndefined();
    });

    it("uses the saved vibes only for pick requests whose filters name no genre", () => {
      const request = { genres: [], moods: [], energy: "high" as const, bpm: null };
      expect(buildSessionPreferences({ activePreset: null, request })?.genres).toEqual([]);
      expect(buildSessionPreferences({ activePreset: null, request, fallbackGenres: ["Jazz"] })?.genres).toEqual(["Jazz"]);
    });
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
        expect.objectContaining({ title: "AI Pick Ready", message: "Playing Main" }),
      );
    });

    it("does not call a rule-based fallback pick an AI pick (#2075)", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      getAgentNextPick.mockResolvedValueOnce({
        status: "ok",
        track: { id: "t-main", title: "Main", artistId: "a-1" },
        tracks: [],
        curatedBy: "rules",
        runtimeFallback: { from: "adk", reason: "error" },
      });
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Pick Ready",
          message: "Playing Main · rule-based pick, the AI curator is unavailable",
        }),
      );
      expect(addToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "AI Pick Ready" }));
    });

    it("records the DJ set before playback starts so starts carry session provenance", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      getAgentNextPick.mockResolvedValueOnce({
        status: "ok",
        track: { id: "t-main", title: "Main", artistId: "a-1" },
        tracks: [{ trackId: "t-extra", licenseType: "personal", priceUsd: 0 }],
      });
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      // Next AI Pick and the continuation use the same preferences.
      const requested = (getAgentNextPick.mock.calls[0] as unknown as [string, { preferences: unknown }])[1];
      expect(setDjSet).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenCalledWith({
        sessionId: "s-open",
        preferences: requested.preferences,
        trackIds: ["t-main", "t-extra"],
      });
      expect(setDjSet.mock.invocationCallOrder[0]).toBeLessThan(playQueue.mock.invocationCallOrder[0]);
    });

    it("restores the previous DJ set when playback fails", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      getAgentNextPick.mockResolvedValueOnce({
        status: "ok",
        track: { id: "t-main", title: "Main", artistId: "a-1" },
      });
      const previous = { sessionId: "previous-session", preferences: {}, trackIds: ["old-track"] };
      hookState.djSet = previous;
      setDjSet.mockImplementationOnce((set) => { hookState.djSet = set; });
      playQueue.mockRejectedValueOnce(new Error("audio blocked"));
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(setDjSet).toHaveBeenCalledTimes(2);
      expect(setDjSet).toHaveBeenLastCalledWith(previous);
    });

    it("records the DJ set for a started session's first picks and clears it on stop", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.onToggle?.();

      hookState.sessions = [session("s-1", ["t-1", "t-2"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(setDjSet).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s-1", trackIds: ["t-1", "t-2"] }),
      );

      hookState.config = config({ isActive: true });
      render();
      await captured.onToggle?.();
      expect(stopSession).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenLastCalledWith(null);
    });

    it("does not touch the player when Next AI Pick returns nothing", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      render();

      await captured.onPick?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(playQueue).not.toHaveBeenCalled();
      // Plain words, never the raw status code (#2056).
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "No new pick",
        message: "You've heard everything that fits this session. Try other filters or another quick start.",
      }));
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

    it("autoplays the cached My Mix batch order instead of unordered pick-log rows", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.onToggle?.();
      hookState.sessions = [{ ...session("s-1", ["t-2"]), mixTrackIds: ["t-1", "t-3", "t-2"] }];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(resolveDjQueue).toHaveBeenCalledWith(["t-1", "t-3", "t-2"], "tok");
      expect(setDjSet.mock.invocationCallOrder[0]).toBeLessThan(playQueue.mock.invocationCallOrder[0]);
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
