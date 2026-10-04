import { resolveAllowExplicit } from "../modules/agents/agent_explicit_preference";

describe("resolveAllowExplicit (#2088)", () => {
  it("lets an explicit boolean on the request win over the saved choice", () => {
    expect(resolveAllowExplicit(true, false)).toBe(true);
    expect(resolveAllowExplicit(false, true)).toBe(false);
  });

  it("falls back to the saved choice when the request sends none", () => {
    expect(resolveAllowExplicit(undefined, true)).toBe(true);
    expect(resolveAllowExplicit(undefined, false)).toBe(false);
    expect(resolveAllowExplicit(null, true)).toBe(true);
  });

  it("defaults to excluding explicit tracks", () => {
    expect(resolveAllowExplicit(undefined, undefined)).toBe(false);
    expect(resolveAllowExplicit(undefined, null)).toBe(false);
  });

  it("ignores non-boolean values sent by a client", () => {
    expect(resolveAllowExplicit("true", false)).toBe(false);
    expect(resolveAllowExplicit(1, undefined)).toBe(false);
    expect(resolveAllowExplicit("false", true)).toBe(true);
  });
});
