import {
  isAgentSessionBuyModeEnabled,
  resolveAgentSessionMode,
} from "../modules/agents/agent_runtime.config";

describe("agent session buy mode (ADR-TE-1)", () => {
  const original = process.env.AGENT_SESSION_BUY_MODE_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AGENT_SESSION_BUY_MODE_ENABLED;
    } else {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = original;
    }
  });

  describe("isAgentSessionBuyModeEnabled", () => {
    it("defaults to off", () => {
      delete process.env.AGENT_SESSION_BUY_MODE_ENABLED;
      expect(isAgentSessionBuyModeEnabled()).toBe(false);
    });

    it.each(["true", "TRUE", " 1 ", "1"])("is on for %p", (value) => {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = value;
      expect(isAgentSessionBuyModeEnabled()).toBe(true);
    });

    it.each(["", "false", "0", "yes", "on"])("is off for %p", (value) => {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = value;
      expect(isAgentSessionBuyModeEnabled()).toBe(false);
    });
  });

  describe("resolveAgentSessionMode", () => {
    it("treats a stored buy mode as curate and flags the downgrade when the flag is off", () => {
      delete process.env.AGENT_SESSION_BUY_MODE_ENABLED;
      expect(resolveAgentSessionMode("buy")).toEqual({ mode: "curate", downgraded: true });
    });

    it("honors a stored buy mode when the flag is on", () => {
      process.env.AGENT_SESSION_BUY_MODE_ENABLED = "true";
      expect(resolveAgentSessionMode("buy")).toEqual({ mode: "buy", downgraded: false });
    });

    it.each(["curate", "", null, undefined, "unknown"])(
      "resolves %p to curate without a downgrade, even with the flag on",
      (stored) => {
        process.env.AGENT_SESSION_BUY_MODE_ENABLED = "true";
        expect(resolveAgentSessionMode(stored as string | null | undefined)).toEqual({
          mode: "curate",
          downgraded: false,
        });
      },
    );
  });
});
