import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ENV_STAMP_KEY,
  classifyEnvironmentChange,
  fetchAppEnvironment,
  getStoredEnvironmentStamp,
  storeEnvironmentStamp,
  type AppEnvironmentStamp,
} from "./appEnvironment";

const base: AppEnvironmentStamp = {
  appVersion: "1.2.3",
  environmentId: "staging",
  dataEpoch: "1",
};

// The web suite runs under the `node` vitest environment; stub a Map-backed
// localStorage + window like the existing productAnalytics test does.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("classifyEnvironmentChange (#1199)", () => {
  it("is 'none' on first run (no stored stamp)", () => {
    expect(classifyEnvironmentChange(null, base)).toBe("none");
  });

  it("is 'none' when nothing changed", () => {
    expect(classifyEnvironmentChange(base, { ...base })).toBe("none");
  });

  it("flags an environmentId change as environment_changed", () => {
    expect(
      classifyEnvironmentChange(base, { ...base, environmentId: "prod" }),
    ).toBe("environment_changed");
  });

  it("flags a dataEpoch bump as environment_changed", () => {
    expect(classifyEnvironmentChange(base, { ...base, dataEpoch: "2" })).toBe(
      "environment_changed",
    );
  });

  it("flags an appVersion change as version_skew", () => {
    expect(
      classifyEnvironmentChange(base, { ...base, appVersion: "1.2.4" }),
    ).toBe("version_skew");
  });

  it("prefers environment_changed when both env and version differ", () => {
    expect(
      classifyEnvironmentChange(base, {
        appVersion: "9.9.9",
        environmentId: "prod",
        dataEpoch: "1",
      }),
    ).toBe("environment_changed");
  });
});

describe("stamp persistence", () => {
  it("round-trips a valid stamp", () => {
    storeEnvironmentStamp(base);
    expect(getStoredEnvironmentStamp()).toEqual(base);
  });

  it("returns null for missing or malformed stamps", () => {
    expect(getStoredEnvironmentStamp()).toBeNull();
    localStorage.setItem(APP_ENV_STAMP_KEY, "{not json");
    expect(getStoredEnvironmentStamp()).toBeNull();
    localStorage.setItem(APP_ENV_STAMP_KEY, JSON.stringify({ appVersion: "x" }));
    expect(getStoredEnvironmentStamp()).toBeNull();
  });
});

describe("fetchAppEnvironment", () => {
  it("returns the stamp from a healthy /health response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", ...base }),
    } as Response);
    expect(await fetchAppEnvironment()).toEqual(base);
  });

  it("returns null (never a false trigger) on error or bad shape", async () => {
    const spy = vi.spyOn(global, "fetch");
    spy.mockRejectedValueOnce(new Error("network"));
    expect(await fetchAppEnvironment()).toBeNull();
    spy.mockResolvedValueOnce({ ok: false } as Response);
    expect(await fetchAppEnvironment()).toBeNull();
    spy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok" }),
    } as Response);
    expect(await fetchAppEnvironment()).toBeNull();
  });
});
