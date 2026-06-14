import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_SESSION_KEY,
  ADDRESS_KEY,
  AUTH_INVALIDATED_EVENT,
  KNOWN_ADDRESSES_KEY,
  PRIVY_USER_KEY,
  SA_ADDRESS_KEY,
  TOKEN_KEY,
  resetLocalAppState,
} from "./authSession";

// `node` vitest env: stub localStorage + a minimal event-capable window.
const listeners = new Map<string, Set<(e: unknown) => void>>();

beforeEach(() => {
  listeners.clear();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal("window", {
    addEventListener: (t: string, cb: (e: unknown) => void) => {
      (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(cb);
    },
    removeEventListener: (t: string, cb: (e: unknown) => void) =>
      listeners.get(t)?.delete(cb),
    dispatchEvent: (e: { type: string }) => {
      listeners.get(e.type)?.forEach((cb) => cb(e));
      return true;
    },
  });
  vi.stubGlobal(
    "CustomEvent",
    class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("resetLocalAppState (#1199)", () => {
  it("clears every app-owned auth + state key", () => {
    for (const key of [
      TOKEN_KEY,
      ADDRESS_KEY,
      SA_ADDRESS_KEY,
      PRIVY_USER_KEY,
      KNOWN_ADDRESSES_KEY,
      AI_SESSION_KEY,
    ]) {
      localStorage.setItem(key, "x");
    }
    // An unrelated key must survive — reset is scoped to app state.
    localStorage.setItem("some.other.app", "keep");

    const cleared = resetLocalAppState();

    expect(cleared).toContain(TOKEN_KEY);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(SA_ADDRESS_KEY)).toBeNull();
    expect(localStorage.getItem(KNOWN_ADDRESSES_KEY)).toBeNull();
    expect(localStorage.getItem(AI_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem("some.other.app")).toBe("keep");
  });

  it("dispatches the auth-invalidated event with a session_reset reason", () => {
    let reason: string | undefined;
    const handler = (e: Event) => {
      reason = (e as CustomEvent).detail?.reason;
    };
    window.addEventListener(AUTH_INVALIDATED_EVENT, handler);
    resetLocalAppState();
    window.removeEventListener(AUTH_INVALIDATED_EVENT, handler);
    expect(reason).toBe("session_reset");
  });
});
