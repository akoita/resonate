import { logDegradedFallback } from "../modules/shared/degraded_fallback";

function capture(input: Parameters<typeof logDegradedFallback>[0]) {
  const lines: string[] = [];
  logDegradedFallback(input, (line) => lines.push(line));
  return JSON.parse(lines[0]);
}

describe("logDegradedFallback (#2076)", () => {
  it("writes a categorical warn event", () => {
    const payload = capture({ component: "agent_runtime.adk", reason: "timeout" });
    expect(payload).toEqual(
      expect.objectContaining({
        level: "warn",
        severity: "WARNING",
        event: "degraded.fallback",
        service: "resonate-backend",
        message: "agent_runtime.adk fell back (timeout)",
        component: "agent_runtime.adk",
        reason: "timeout",
      }),
    );
    expect(payload.errorClass).toBeUndefined();
  });

  it("lowercases a valid reason and maps anything else to other", () => {
    expect(capture({ component: "taste_profile", reason: "Rate_Limited" }).reason).toBe("rate_limited");
    for (const bad of ["http 503", "http-503", "9lives", "", "has space", "a".repeat(49), "user-42@x.io"]) {
      expect(capture({ component: "taste_profile", reason: bad }).reason).toBe("other");
    }
    expect(capture({ component: "taste_profile", reason: "a".repeat(48) }).reason).toBe("a".repeat(48));
  });

  it("records the error class but never the message", () => {
    const payload = capture({
      component: "embeddings.provider",
      reason: "error",
      error: new TypeError("user-123 secret detail"),
    });
    expect(payload.errorClass).toBe("TypeError");
    expect(JSON.stringify(payload)).not.toContain("user-123");
    expect(payload.stack_trace).toBeUndefined();
  });

  it("ignores a non-Error error value", () => {
    const payload = capture({ component: "served_history", reason: "unavailable", error: "text" });
    expect(payload.errorClass).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("text\"");
  });

  it("never throws, even when the writer throws", () => {
    expect(() =>
      logDegradedFallback({ component: "served_history", reason: "unavailable" }, () => {
        throw new Error("writer broke");
      }),
    ).not.toThrow();
  });
});
