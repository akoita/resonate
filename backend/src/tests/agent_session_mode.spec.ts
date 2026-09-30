import {
  isAgentSessionBuyModeEnabled,
  resolveAgentSessionMode,
} from "../modules/agents/agent_session_mode";

describe("isAgentSessionBuyModeEnabled", () => {
  it("is off when unset", () => {
    expect(isAgentSessionBuyModeEnabled({})).toBe(false);
  });

  it("is on only for the exact string true", () => {
    expect(isAgentSessionBuyModeEnabled({ AGENT_SESSION_BUY_MODE_ENABLED: "true" })).toBe(true);
    for (const value of ["false", "1", "TRUE", "yes", ""]) {
      expect(isAgentSessionBuyModeEnabled({ AGENT_SESSION_BUY_MODE_ENABLED: value })).toBe(false);
    }
  });
});

describe("resolveAgentSessionMode", () => {
  it("honors buy when enabled", () => {
    expect(resolveAgentSessionMode("buy", true)).toEqual({ mode: "buy", downgraded: false });
  });

  it("downgrades buy to curate when disabled", () => {
    expect(resolveAgentSessionMode("buy", false)).toEqual({ mode: "curate", downgraded: true });
  });

  it("keeps curate regardless of the flag", () => {
    expect(resolveAgentSessionMode("curate", true)).toEqual({ mode: "curate", downgraded: false });
    expect(resolveAgentSessionMode("curate", false)).toEqual({ mode: "curate", downgraded: false });
  });

  it("resolves unknown, null and undefined to curate without downgrade", () => {
    for (const stored of ["auto", "", null, undefined]) {
      expect(resolveAgentSessionMode(stored, true)).toEqual({ mode: "curate", downgraded: false });
      expect(resolveAgentSessionMode(stored, false)).toEqual({ mode: "curate", downgraded: false });
    }
  });
});
