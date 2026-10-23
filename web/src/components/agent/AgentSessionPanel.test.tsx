import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentConfig,
  DiscoveryJournal,
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
  journal: null as DiscoveryJournal | null,
  journalLoading: false,
};
const startSession = vi.fn(async () => ({ status: "started", sessionId: "s-1" }));
const stopSession = vi.fn(async () => ({ status: "stopped" }));
const updateConfig = vi.fn(async () => undefined);
const createConfig = vi.fn(async () => undefined);
const refetchConfig = vi.fn(async () => undefined);
const refetchHistory = vi.fn(async () => undefined);
const addToast = vi.fn();
const recordProductAnalytics = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
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
const getAgentSounds = vi.fn(async (...args: unknown[]): Promise<unknown> => {
  void args;
  throw new Error("sounds unavailable");
});
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
  getAgentSounds: (...args: unknown[]) => getAgentSounds(...args),
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

vi.mock("../../hooks/useDiscoveryJournal", () => ({
  useDiscoveryJournal: () => ({
    journal: hookState.journal,
    isLoading: hookState.journalLoading,
    error: null,
    refetch: vi.fn(),
  }),
}));

type UpNextPreferences = { myMix?: unknown; request: { genres: string[] } };

// Capture the command bar's Stop handler; Start is the prompt's onSubmit (#2237).
const captured: {
  onStop?: () => void;
  commandBar?: { name: string; isLive: boolean };
  upNext?: { buildPreferences: () => UpNextPreferences; sessionId: string | null };
  card?: { sessionLive: boolean };
  prompt?: PromptProps;
} = {};
vi.mock("./AgentCommandBar", () => ({
  default: (props: { name: string; isLive: boolean; onStop: () => void }) => {
    captured.onStop = props.onStop;
    captured.commandBar = { name: props.name, isLive: props.isLive };
    return null;
  },
}));
// The Now & Up next hook and card have their own tests; the panel only wires them (#2243).
vi.mock("./useDjUpNext", () => ({
  useDjUpNext: (options: { buildPreferences: () => UpNextPreferences; sessionId: string | null }) => {
    captured.upNext = options;
    return { view: { now: null, upNext: [] }, busy: null, notice: null, skip: vi.fn(), notThis: vi.fn(), moreLikeThis: vi.fn() };
  },
}));
vi.mock("./AgentUpNextCard", () => ({
  default: (props: { sessionLive: boolean }) => {
    captured.card = props;
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
vi.mock("./AgentEventsDebug", () => ({ default: () => null }));
vi.mock("./AgentSetupWizard", () => ({ default: () => null }));

import AgentSessionPanel, { toIntentPreferences } from "./AgentSessionPanel";
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
    captured.onStop = undefined;
    captured.commandBar = undefined;
    captured.upNext = undefined;
    captured.card = undefined;
    captured.prompt = undefined;
    hookState.events = [];
    hookState.queue = [];
    hookState.currentIndex = 0;
    hookState.djSet = null;
    hookState.journal = null;
    hookState.journalLoading = false;
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
    expect(captured.commandBar?.name).toBe("Night DJ");
  });

  it("renders the command bar for an inactive DJ and starts a session", async () => {
    hookState.config = config({ isActive: false });
    const html = render();
    // The command bar is a separate component; here the panel hands it the name and state.
    expect(captured.commandBar).toEqual({ name: "Night DJ", isLive: false });
    // The only start action is the prompt's button (#2237).
    expect(html).not.toContain("Start Session");
    expect(captured.prompt?.isLive).toBe(false);
    // No ERC-8004 identity actions, no Crate Digger banner.
    expect(html).not.toContain("Portable Identity");
    expect(html).not.toContain("Crate Digger");

    await captured.prompt?.onSubmit();
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
    // The starter's sentence is written into the prompt for the listener to edit.
    expect(captured.prompt?.text).toBe(preset!.sentence);
    // A preset stands for known filters: nothing is parsed.
    await vi.advanceTimersByTimeAsync(2000);
    expect(parseAgentSessionRequest).not.toHaveBeenCalled();

    await captured.prompt?.onSubmit();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledTimes(1);
    const [input] = startSession.mock.calls[0] as unknown as [{ preferences: Record<string, unknown> }];
    expect(input.preferences).toEqual({ ...toIntentPreferences(preset!), request: requestFromPreset(preset!) });
    expect(input.preferences).toEqual(
      expect.objectContaining({
        mood: "Hype",
        energy: "high",
        sessionIntent: "Hype",
        sessionIntentName: "High energy",
      }),
    );
    // A Moments starter never names a genre (#2249).
    expect(input.preferences.genres).toEqual([]);
    expect((input.preferences.request as { genres: string[] }).genres).toEqual([]);
    expect(input.preferences).not.toHaveProperty("licenseType");
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.intent_selected",
      expect.objectContaining({
        payload: expect.objectContaining({ intent: "Hype", starterRow: "moments", starterId: "Hype" }),
      }),
    );
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.session_started",
      expect.objectContaining({
        payload: expect.objectContaining({
          startedFrom: "preset",
          intent: "Hype",
          starterRow: "moments",
          starterId: "Hype",
          starterEdited: false,
          optionalFilters: [],
          requestFilterKeys: ["moods", "energy"],
          unparsedCount: 0,
          ignoredKeys: [],
        }),
      }),
    );
  });

  describe("catalog-aware Sounds (#2249)", () => {
    async function loadSounds() {
      render();
      effects.forEach((run) => run());
      await Promise.resolve();
      await Promise.resolve();
      render();
    }

    it("keeps today's Sounds starters when the request fails", async () => {
      hookState.config = config({ isActive: false });
      await loadSounds();
      expect(getAgentSounds).toHaveBeenCalledWith("tok", undefined);
      expect(captured.prompt?.presets).toEqual(SESSION_PRESETS);
      expect(captured.prompt?.soundCounts).toBeUndefined();
    });

    it("shows the families the catalog returned, in order, hiding thin ones", async () => {
      getAgentSounds.mockResolvedValueOnce({
        minTracks: 3,
        families: [
          { id: "world", label: "World", count: 41 },
          { id: "jazz", label: "Jazz", count: 12 },
          { id: "pop", label: "Pop", count: 2 },
          { id: "hip-hop", label: "Hip-Hop", count: 5 },
        ],
      });
      hookState.config = config({ isActive: false, allowExplicit: true });
      await loadSounds();
      expect(getAgentSounds).toHaveBeenCalledWith("tok", true);
      const sounds = captured.prompt!.presets!.filter((preset) => preset.group === "genre");
      expect(sounds.map((preset) => preset.intent)).toEqual(["World", "Jazz", "Hip-Hop"]);
      expect(captured.prompt?.soundCounts).toEqual({ World: 41, Jazz: 12, "Hip-Hop": 5 });
      // Moments are unaffected.
      expect(captured.prompt!.presets!.filter((preset) => preset.group === "mood")).toHaveLength(8);
    });
  });

  describe("starters and optional filters (#2249)", () => {
    const starter = (intent: string) => SESSION_PRESETS.find((candidate) => candidate.intent === intent)!;

    it("writes a starter's sentence into the prompt and shows its chips", () => {
      hookState.config = config({ isActive: false });
      render();
      captured.prompt?.onSelectPreset(starter("Club"));
      render();
      expect(captured.prompt?.text).toBe("Club, high energy, around 124 BPM");
      expect(captured.prompt?.request).toEqual({
        genres: [],
        moods: ["Club"],
        energy: "high",
        bpm: { min: 121, max: 127 },
      });
      expect(parseAgentSessionRequest).not.toHaveBeenCalled();
    });

    it("sends no genre from any Moments starter", async () => {
      for (const preset of SESSION_PRESETS.filter((candidate) => candidate.group === "mood")) {
        vi.clearAllMocks();
        hookState.config = config({ isActive: false, vibes: ["Jazz"] });
        render();
        captured.prompt?.onSelectPreset(preset);
        render();
        await captured.prompt?.onSubmit();
        const [input] = startSession.mock.calls[0] as unknown as [{ preferences: { genres?: string[]; request: { genres: string[] } } }];
        expect([preset.name, input.preferences.genres ?? []]).toEqual([preset.name, []]);
        expect([preset.name, input.preferences.request.genres]).toEqual([preset.name, []]);
      }
    });

    it("combines a starter with the Energy filter into one request, in either order", async () => {
      hookState.config = config({ isActive: false });
      render();
      captured.prompt?.onSelectPreset(starter("Afrobeats"));
      render();
      captured.prompt?.onEnergyChange("low");
      render();
      expect(captured.prompt?.activePresetIntent).toBe("Afrobeats");
      expect(captured.prompt?.request).toEqual({
        genres: ["Afrobeat", "Afro-Pop", "Amapiano"],
        moods: [],
        energy: "low",
        bpm: null,
      });
      await captured.prompt?.onSubmit();
      const [input] = startSession.mock.calls[0] as unknown as [{ preferences: Record<string, unknown> }];
      expect(input.preferences).toMatchObject({
        genres: ["Afrobeat", "Afro-Pop", "Amapiano"],
        energy: "low",
        sessionIntent: "Afrobeats",
        request: { energy: "low" },
      });

      // Energy first, then the starter: the chosen energy survives the starter.
      vi.clearAllMocks();
      slots.length = 0;
      hookState.config = config({ isActive: false });
      render();
      captured.prompt?.onEnergyChange("high");
      render();
      captured.prompt?.onSelectPreset(starter("Zen"));
      render();
      expect(captured.prompt?.request).toMatchObject({ moods: ["Zen"], energy: "high" });
    });

    it("clears only the Energy filter when it is set back to Any, keeping the starter's genres", () => {
      hookState.config = config({ isActive: false });
      render();
      captured.prompt?.onSelectPreset(starter("Reggae"));
      render();
      captured.prompt?.onEnergyChange("high");
      render();
      captured.prompt?.onEnergyChange(null);
      render();
      expect(captured.prompt?.request).toEqual({
        genres: ["Reggae", "Dancehall", "Dub"],
        moods: [],
        energy: null,
        bpm: null,
      });
    });

    it("removing a chip removes only that filter", () => {
      hookState.config = config({ isActive: false });
      render();
      captured.prompt?.onSelectPreset(starter("Club"));
      render();
      captured.prompt?.onRemoveChip("bpm");
      render();
      expect(captured.prompt?.request).toEqual({ genres: [], moods: ["Club"], energy: "high", bpm: null });
      captured.prompt?.onRemoveChip("energy");
      render();
      expect(captured.prompt?.request).toEqual({ genres: [], moods: ["Club"], energy: null, bpm: null });
    });

    it("records the starter, whether it was edited, and the optional filters used, with no text", async () => {
      hookState.config = config({ isActive: false, allowExplicit: true });
      render();
      captured.prompt?.onSelectPreset(starter("Latin"));
      render();
      captured.prompt?.onEnergyChange("medium");
      render();
      captured.prompt?.onTextChange("Latin, reggaeton, dembow");
      render();
      await vi.advanceTimersByTimeAsync(600);
      render();
      await captured.prompt?.onSubmit();
      const started = recordProductAnalytics.mock.calls.find((call) => call[1] === "agent.session_started");
      expect(started?.[2]).toMatchObject({
        payload: { starterRow: "sounds", starterId: "Latin", starterEdited: true, optionalFilters: ["explicit"] },
      });
      expect(JSON.stringify(recordProductAnalytics.mock.calls)).not.toContain("dembow");
    });

    it("counts the Energy filter as used when it was set from the Adjust row", async () => {
      hookState.config = config({ isActive: false });
      render();
      captured.prompt?.onSelectPreset(starter("Reggae"));
      render();
      captured.prompt?.onEnergyChange("high");
      render();
      await captured.prompt?.onSubmit();
      const started = recordProductAnalytics.mock.calls.find((call) => call[1] === "agent.session_started");
      expect(started?.[2]).toMatchObject({
        payload: { starterRow: "sounds", starterId: "Reggae", starterEdited: false, optionalFilters: ["energy"] },
      });
    });
  });

  it("shows the saved explicit-tracks choice, off by default (#2088)", () => {
    hookState.config = config({ isActive: false });
    render();
    expect(captured.prompt?.explicit).toMatchObject({ enabled: false, isSaving: false, error: null });

    hookState.config = config({ isActive: false, allowExplicit: true });
    render();
    expect(captured.prompt?.explicit?.enabled).toBe(true);
  });

  it("saves the explicit-tracks choice through the config update, optimistically (#2088)", async () => {
    hookState.config = config({ isActive: true });
    render();
    let release: () => void = () => undefined;
    updateConfig.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));

    const saving = captured.prompt?.explicit?.onChange(true);
    render();
    expect(updateConfig).toHaveBeenCalledWith({ allowExplicit: true });
    expect(captured.prompt?.explicit).toMatchObject({ enabled: true, isSaving: true });

    release();
    await saving;
    render();
    expect(captured.prompt?.explicit).toMatchObject({ isSaving: false, error: null });
    // A saved choice is not sent with the session: the server resolves it on every pick.
    expect(startSession).not.toHaveBeenCalled();
  });

  it("reverts the explicit-tracks choice and says so when saving fails (#2088)", async () => {
    hookState.config = config({ isActive: false, allowExplicit: false });
    render();
    updateConfig.mockRejectedValueOnce(new Error("Network down"));

    await captured.prompt?.explicit?.onChange(true);
    render();
    expect(captured.prompt?.explicit).toMatchObject({
      enabled: false,
      isSaving: false,
      error: "Couldn't save this setting. Network down",
    });
  });

  it("starts a plain session with no preferences when nothing was typed or chosen", async () => {
    hookState.config = config({ isActive: false });
    render();
    await captured.prompt?.onSubmit();
    expect(startSession).toHaveBeenCalledWith(undefined);
    expect(recordProductAnalytics).toHaveBeenCalledWith(
      "tok",
      "agent.session_started",
      expect.objectContaining({
        // Starts come from the prompt's button now; the command bar only stops.
        source: "agent_session_prompt",
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
    await captured.prompt?.onSubmit();

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

    it("starts from the filters plus the sentence, and never records the sentence anywhere else", async () => {
      hookState.config = config({ isActive: false });
      parseAgentSessionRequest.mockResolvedValueOnce(parsed);
      render();
      captured.prompt?.onTextChange(SENTENCE);
      render();

      // Still reading: starting now would ignore the sentence.
      await captured.prompt?.onSubmit();
      expect(startSession).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      render();
      await captured.prompt?.onSubmit();

      expect(startSession).toHaveBeenCalledWith({
        preferences: {
          // The sentence joins the DJ's search for this session (#2241); nothing else keeps it.
          requestText: SENTENCE,
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

      // Only the start request carries the sentence: not analytics (setDjSet drops it before
      // the sessionStorage mirror; see agentDjSet.test.ts).
      const elsewhere = JSON.stringify({ analytics: recordProductAnalytics.mock.calls });
      for (const fragment of ["cooking", "122", "A minor", "$5", SENTENCE]) {
        expect(elsewhere).not.toContain(fragment);
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
      await captured.prompt?.onSubmit();
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

      await captured.prompt?.onSubmit();
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
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hip-Hop")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:Trap"));

      getAgentNextPick.mockResolvedValueOnce(
        pickResponse(["n1", "n2"], { requestCoverage: { picks: 2, gaps: [{ filter: "energy", matched: 1 }] } }),
      );
      refetchHistory.mockClear();
      await vi.advanceTimersByTimeAsync(800);
      await vi.advanceTimersByTimeAsync(0);

      expect(getAgentNextPick).toHaveBeenCalledTimes(1);
      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [
        string,
        { sessionId: string; preferences: { request: { genres: string[] }; source: string } },
      ];
      expect(body.sessionId).toBe("s-open");
      expect(body.preferences.request.genres).toEqual(["Hip-Hop", "Rap"]);
      expect(body.preferences.source).toBe("agent_session_prompt");

      // Upcoming DJ picks (indices 1 and 2) go, highest first; the listener's own track and the current one stay.
      expect(removeFromQueue.mock.calls.map(([index]) => index)).toEqual([2, 1]);
      expect(resolveDjQueue).toHaveBeenCalledWith(["n1", "n2"], "tok");
      expect(addTracksToQueue).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenCalledWith({
        sessionId: "s-open",
        preferences: body.preferences,
        trackIds: ["a", "n1", "n2"],
        // What the Now & Up next card says about the new picks; no reason without an explanation.
        picks: { n1: { source: "rules" }, n2: { source: "rules" } },
      });
      expect(playQueue).not.toHaveBeenCalled();
      // Session History shows the re-planned picks, not the previous request's (#2094).
      expect(refetchHistory).toHaveBeenCalledTimes(1);

      render();
      expect(captured.prompt?.coverage).toEqual({ picks: 2, gaps: [{ filter: "energy", matched: 1 }] });
    });

    it("re-plans once for rapid chip removals", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hip-Hop")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await vi.advanceTimersByTimeAsync(300);
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:Trap"));
      await vi.advanceTimersByTimeAsync(300);
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:Rap"));
      await vi.advanceTimersByTimeAsync(300);
      expect(getAgentNextPick).not.toHaveBeenCalled();

      getAgentNextPick.mockResolvedValueOnce(pickResponse(["n1"]));
      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(0);
      expect(getAgentNextPick).toHaveBeenCalledTimes(1);
      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [string, { preferences: { request: { genres: string[] } } }];
      expect(body.preferences.request.genres).toEqual(["Hip-Hop"]);
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

    it("clears remembered My Mix preferences when the listener switches to a regular preset", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      await loadMyMixCatalog();
      captured.prompt?.myMix?.onSelect();
      render();
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      captured.prompt?.onSelectPreset(preset);
      render();

      // The Up next actions ask the DJ with these preferences.
      expect(captured.upNext?.buildPreferences()).toHaveProperty("myMix", null);
    });

    it("only updates local state when no DJ set is live yet", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hip-Hop")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:Trap"));
      await vi.advanceTimersByTimeAsync(800);
      await vi.advanceTimersByTimeAsync(0);
      expect(getAgentNextPick).not.toHaveBeenCalled();

      // The next picks follow the edited filters.
      expect(captured.upNext?.buildPreferences().request.genres).toEqual(["Hip-Hop", "Rap"]);
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

    it("Update session with nothing playing asks the DJ with the edited filters and starts the picks", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hip-Hop")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await editAndRender(() => captured.prompt?.onRemoveChip("genre:Trap"));
      await vi.advanceTimersByTimeAsync(800);
      expect(getAgentNextPick).not.toHaveBeenCalled();

      getAgentNextPick.mockResolvedValueOnce(
        pickResponse(["p1", "p2"], { explanation: ["Fits this session intent"], curatedBy: "llm" }),
      );
      await captured.prompt?.onSubmit();

      const [, body] = getAgentNextPick.mock.calls[0] as unknown as [string, { sessionId: string; preferences: { request: { genres: string[] } } }];
      expect(body.sessionId).toBe("s-open");
      expect(body.preferences.request.genres).toEqual(["Hip-Hop", "Rap"]);
      expect(playQueue).toHaveBeenCalledTimes(1);
      const [queue] = playQueue.mock.calls[0] as unknown as [LocalTrack[]];
      expect(queue.map((entry) => entry.id)).toEqual(["p1", "p2"]);
      expect(setDjSet).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "s-open",
          trackIds: ["p1", "p2"],
          picks: { p1: { reason: "Fits this session intent", source: "ai" }, p2: { source: "ai" } },
        }),
      );
    });

    it("Update session with nothing playing and nothing found says why and keeps My Mix coverage", async () => {
      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      await loadMyMixCatalog();
      captured.prompt?.myMix?.onSelect();
      render();
      effects.forEach((run) => run());
      getAgentNextPick.mockResolvedValueOnce({
        status: "no_tracks",
        reason: "all_candidates_recently_played",
        mixCoverage: { lanes: [{ id: myMixLane.id, label: "Soul · Warm", requested: 3, matched: 0 }] },
      });
      await captured.prompt?.onSubmit();
      render();

      expect(playQueue).not.toHaveBeenCalled();
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "No new picks for those filters" }));
      expect(captured.prompt?.myMix?.coverage).toEqual({
        lanes: [{ id: myMixLane.id, label: "Soul · Warm", requested: 3, matched: 0 }],
      });
    });

    it("stopping the session cancels a pending re-plan", async () => {
      setUpLiveSet();
      render();
      effects.forEach((run) => run());
      const preset = SESSION_PRESETS.find((candidate) => candidate.intent === "Hype")!;
      await editAndRender(() => captured.prompt?.onSelectPreset(preset));
      await captured.onStop?.();
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

  it("goes idle, start (prompt button), live (Update / Stop), stop, with one start control", async () => {
    hookState.config = config({ isActive: false });
    render();
    expect(captured.prompt?.isLive).toBe(false);
    expect(captured.commandBar?.isLive).toBe(false);
    // The prompt is the only thing handed a start action.
    expect(captured.prompt?.onSubmit).toBeTypeOf("function");
    expect(captured.onStop).toBeTypeOf("function");

    await captured.prompt?.onSubmit();
    expect(startSession).toHaveBeenCalledTimes(1);

    hookState.config = config({ isActive: true });
    render();
    expect(captured.prompt?.isLive).toBe(true);
    expect(captured.commandBar?.isLive).toBe(true);

    await captured.onStop?.();
    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledTimes(1);
  });

  it("stops a live session", async () => {
    hookState.config = config({ isActive: true });
    render();
    expect(captured.commandBar).toEqual({ name: "Night DJ", isLive: true });

    await captured.onStop?.();
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

  describe("Sonic Radar banner", () => {
    const pendingItem = (id: string) => ({
      trackId: id,
      title: `Title ${id}`,
      artistId: "a1",
      artistName: "Artist",
      releaseId: `r-${id}`,
      releaseTitle: "Release",
      artworkUrl: null,
      hasUploadedArtwork: false,
      artworkRevision: 1,
      completedAt: "2026-10-02T10:00:00.000Z",
      followUpBy: "2026-10-09T10:00:00.000Z",
      discovery: false,
    });
    const resonantItem = (id: string) => ({
      ...pendingItem(id),
      resonatedAt: "2026-10-02T10:00:00.000Z",
      followUp: "saved" as const,
      reason: { code: "listening_pattern", text: "Fit" },
      nextAction: null,
    });
    const newRelease = (id: string) => ({
      trackId: id,
      title: `New ${id}`,
      artistId: "a2",
      artistName: "Artist Two",
      releaseId: `r-${id}`,
      releaseTitle: "Release",
      artworkUrl: null,
      hasUploadedArtwork: false,
      artworkRevision: 1,
      addedAt: "2026-10-03T10:00:00.000Z",
      reason: { code: "new_from_discovered_artist", text: "New from an artist you discovered" },
    });
    const journal = (resonant: number, pending: number, newArtists = 0, newTracks?: number): DiscoveryJournal => ({
      schemaVersion: "discovery-journal/v1",
      window: { days: 28, from: "2026-09-06T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" },
      headline: { resonantDiscoveriesThisWeek: resonant, newArtistsThisWeek: newArtists },
      groups: resonant
        ? [{ key: "day:2026-10-02", sessionId: null, date: "2026-10-02", items: Array.from({ length: resonant }, (_, i) => resonantItem(`t${i}`)) }]
        : [],
      pending: Array.from({ length: pending }, (_, i) => pendingItem(`p${i}`)),
      ...(newTracks === undefined
        ? {}
        : { newFromDiscovered: Array.from({ length: newTracks }, (_, i) => newRelease(`n${i}`)) }),
    });

    beforeEach(() => {
      hookState.config = config();
    });

    it("counts resonant tracks and new artists from the journal", () => {
      hookState.journal = journal(3, 2, 2);
      const html = render();
      expect(html).toContain("aid-discovery-banner");
      expect(html).toMatch(/<strong>3<\/strong> tracks resonated with you in the last 28 days/);
      expect(html).toMatch(/<strong>2<\/strong> new artists this week/);
      expect(html).toMatch(/<a[^>]*href="\/sonic-radar"[^>]*>View on Sonic Radar →<\/a>/);
      expect(html).not.toContain("tracks discovered");
    });

    it("mentions new tracks from artists you discovered when there are some", () => {
      hookState.journal = journal(3, 0, 2, 4);
      expect(render()).toMatch(/<strong>4<\/strong> new tracks from artists you discovered/);
      hookState.journal = journal(3, 0, 0, 1);
      expect(render()).toMatch(/<strong>1<\/strong> new track from artists you discovered/);
    });

    it("omits the new-tracks mention when there are none or the backend predates it", () => {
      hookState.journal = journal(3, 0, 2, 0);
      expect(render()).not.toContain("from artists you discovered");
      hookState.journal = journal(3, 0, 2);
      expect(render()).not.toContain("from artists you discovered");
    });

    it("uses singular copy and omits new artists when there are none", () => {
      hookState.journal = journal(1, 0, 0);
      const html = render();
      expect(html).toMatch(/<strong>1<\/strong> track resonated with you/);
      expect(html).not.toContain("new artist");
    });

    it("points at the pending tracks when nothing has resonated yet", () => {
      hookState.journal = journal(0, 4);
      const html = render();
      expect(html).toMatch(/<strong>4<\/strong> tracks you played through this week are one save away from your Sonic Radar/);
      expect(html).toMatch(/<a[^>]*href="\/sonic-radar"[^>]*>Review them →<\/a>/);
    });

    it("uses singular verb for a single pending track", () => {
      hookState.journal = journal(0, 1);
      expect(render()).toMatch(/<strong>1<\/strong> track you played through this week is one save away/);
    });

    it("explains how tracks land in Sonic Radar when the journal is empty", () => {
      hookState.journal = journal(0, 0);
      const html = render();
      expect(html).toContain("Play a track all the way through, then save or replay it, and it lands in your Sonic Radar.");
      expect(html).toMatch(/<a[^>]*href="\/sonic-radar"[^>]*>Open Sonic Radar →<\/a>/);
    });

    it("shows no banner while the journal loads or is unavailable", () => {
      hookState.journal = journal(3, 0);
      hookState.journalLoading = true;
      expect(render()).not.toContain("aid-discovery-banner");
      hookState.journalLoading = false;
      hookState.journal = null;
      expect(render()).not.toContain("aid-discovery-banner");
    });

    it("does not depend on the AI DJ session history", () => {
      hookState.sessions = [session("s-1", ["t1", "t2"])];
      hookState.journal = journal(0, 0);
      const html = render();
      expect(html).not.toContain("tracks discovered");
      expect(html).toContain("Open Sonic Radar →");
    });
  });

  describe("Now & Up next wiring (#2243)", () => {
    it("shows the card live only while a session is open, and asks the DJ with the live filters", () => {
      hookState.config = config({ isActive: false });
      render();
      expect(captured.card?.sessionLive).toBe(false);
      expect(captured.upNext?.sessionId).toBeNull();

      hookState.config = config({ isActive: true });
      hookState.sessions = [session("s-open", [])];
      render();
      expect(captured.card?.sessionLive).toBe(true);
      expect(captured.upNext?.sessionId).toBe("s-open");
    });
  });

  describe("DJ playback", () => {
    async function autoplayStartedSession(ids: string[]) {
      hookState.config = config({ isActive: false });
      render();
      await captured.prompt?.onSubmit();
      hookState.sessions = [session("s-1", ids)];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
    }

    it("records the DJ set before playback starts so starts carry session provenance", async () => {
      await autoplayStartedSession(["t-main", "t-extra"]);

      expect(resolveDjQueue).toHaveBeenCalledWith(["t-main", "t-extra"], "tok");
      expect(setDjSet).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenCalledWith({
        sessionId: "s-1",
        preferences: captured.upNext?.buildPreferences(),
        trackIds: ["t-main", "t-extra"],
      });
      expect(setDjSet.mock.invocationCallOrder[0]).toBeLessThan(playQueue.mock.invocationCallOrder[0]);
      const [queue, startIndex] = playQueue.mock.calls[0] as unknown as [LocalTrack[], number];
      expect(queue.map((entry) => entry.id)).toEqual(["t-main", "t-extra"]);
      expect(startIndex).toBe(0);
      expect(saveTracksMetadata).toHaveBeenCalledWith(queue, "remote");
    });

    it("gives the first picks their reasons from Session History", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.prompt?.onSubmit();
      const withReasons = session("s-1", ["t-main", "t-extra"]);
      withReasons.licenses[0].recommendation = {
        recommendation: { explanation: ["Catalog candidate", "Fits this session intent"] },
        curatedBy: "llm",
      };
      withReasons.licenses[1].recommendation = { curatedBy: "rules" };
      hookState.sessions = [withReasons];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);

      expect(setDjSet).toHaveBeenCalledWith(
        expect.objectContaining({
          trackIds: ["t-main", "t-extra"],
          picks: {
            "t-main": { reason: "Fits this session intent", source: "ai" },
            "t-extra": { source: "rules" },
          },
        }),
      );
    });

    it("restores the previous DJ set when playback fails", async () => {
      const previous = { sessionId: "previous-session", preferences: {}, trackIds: ["old-track"] };
      hookState.djSet = previous;
      setDjSet.mockImplementationOnce((set) => { hookState.djSet = set; });
      playQueue.mockRejectedValueOnce(new Error("audio blocked"));

      await autoplayStartedSession(["t-main"]);

      expect(setDjSet).toHaveBeenCalledTimes(2);
      expect(setDjSet).toHaveBeenLastCalledWith(previous);
    });

    it("records the DJ set for a started session's first picks and clears it on stop", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.prompt?.onSubmit();

      hookState.sessions = [session("s-1", ["t-1", "t-2"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(setDjSet).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s-1", trackIds: ["t-1", "t-2"] }),
      );

      hookState.config = config({ isActive: true });
      render();
      await captured.onStop?.();
      expect(stopSession).toHaveBeenCalledTimes(1);
      expect(setDjSet).toHaveBeenLastCalledWith(null);
    });

    it("toasts when the DJ's picks cannot be played", async () => {
      playQueue.mockRejectedValueOnce(new Error("audio blocked"));

      await autoplayStartedSession(["t-main"]);

      expect(addToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", title: "Couldn't play the DJ's picks", message: "audio blocked" }),
      );
    });

    it("plays a started session's picks once when they appear in history", async () => {
      hookState.config = config({ isActive: false });
      render();
      await captured.prompt?.onSubmit();
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
      await captured.prompt?.onSubmit();
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
      await captured.prompt?.onSubmit();

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
      await captured.prompt?.onSubmit();

      hookState.config = config({ isActive: true });
      render();
      await captured.onStop?.();
      expect(stopSession).toHaveBeenCalledTimes(1);

      hookState.sessions = [session("s-1", ["t-1"])];
      render();
      effects.forEach((run) => run());
      await vi.advanceTimersByTimeAsync(0);
      expect(playQueue).not.toHaveBeenCalled();
    });
  });
});
