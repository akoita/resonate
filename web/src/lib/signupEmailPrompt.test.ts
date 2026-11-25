import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSignupEmailPrompt,
  hasSignupEmailPrompt,
  markSignupEmailPrompt,
} from "./signupEmailPrompt";

describe("sign-up email prompt (#2665)", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is offered once after sign-up, then cleared", () => {
    expect(hasSignupEmailPrompt()).toBe(false);
    markSignupEmailPrompt();
    expect(hasSignupEmailPrompt()).toBe(true);
    clearSignupEmailPrompt();
    expect(hasSignupEmailPrompt()).toBe(false);
  });

  it("skips the offer quietly when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(() => markSignupEmailPrompt()).not.toThrow();
    expect(hasSignupEmailPrompt()).toBe(false);
  });

});
