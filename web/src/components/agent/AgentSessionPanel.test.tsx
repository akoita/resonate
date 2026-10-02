import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, AgentSession } from "../../lib/api";

// Effects never run in a server render, so record them and run them by hand.
const effects: Array<() => void | (() => void)> = [];
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => {
      effects.push(fn);
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
vi.mock("../../hooks/useAgentEvents", () => ({ useAgentEvents: () => [] }));
vi.mock("../../hooks/useAgentHistory", () => ({
  useAgentHistory: () => ({
    sessions: hookState.sessions,
    isLoading: hookState.historyLoading,
    refetch: refetchHistory,
  }),
}));

// Capture the status card's toggle so the Start/Stop handler can be invoked.
const captured: { onToggle?: () => void } = {};
vi.mock("./AgentStatusCard", () => ({
  default: (props: { onToggle: () => void }) => {
    captured.onToggle = props.onToggle;
    return null;
  },
}));
vi.mock("./AgentActivityFeed", () => ({ default: () => null }));
vi.mock("./AgentNextPickCard", () => ({ default: () => null }));
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

function render(refreshKey?: number) {
  effects.length = 0;
  const html = renderToStaticMarkup(<AgentSessionPanel refreshKey={refreshKey} />);
  return html;
}

describe("AgentSessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.config = null;
    hookState.isLoading = false;
    hookState.sessions = [];
    hookState.historyLoading = false;
    captured.onToggle = undefined;
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
});
