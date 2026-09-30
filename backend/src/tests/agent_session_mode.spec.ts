import { isAgentSessionBuyModeEnabled, resolveEffectiveSessionMode } from "../modules/agents/agent_session_mode";

describe("agent session mode (ADR-TE-1)", () => {
  afterEach(() => {
    delete process.env.AGENT_SESSION_BUY_MODE_ENABLED;
  });

  it("defaults the buy-mode flag to off", () => {
    expect(isAgentSessionBuyModeEnabled()).toBe(false);
    expect(resolveEffectiveSessionMode("buy")).toBe("curate");
  });

  it.each(["", "false", "1", "yes"])("treats %p as off", (value) => {
    process.env.AGENT_SESSION_BUY_MODE_ENABLED = value;
    expect(resolveEffectiveSessionMode("buy")).toBe("curate");
  });

  it("honors a stored buy mode only when the flag is exactly true", () => {
    process.env.AGENT_SESSION_BUY_MODE_ENABLED = " TRUE ";
    expect(isAgentSessionBuyModeEnabled()).toBe(true);
    expect(resolveEffectiveSessionMode("buy")).toBe("buy");
  });

  it.each(["curate", "", null, undefined, "unknown"])("resolves %p to curate", (mode) => {
    process.env.AGENT_SESSION_BUY_MODE_ENABLED = "true";
    expect(resolveEffectiveSessionMode(mode)).toBe("curate");
  });
});
