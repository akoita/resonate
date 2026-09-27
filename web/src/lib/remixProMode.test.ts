import { describe, expect, it } from "vitest";
import {
  PRO_MODE_STORAGE_KEY,
  proModeAllowed,
  readProMode,
  writeProMode,
} from "./remixProMode";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("Remix Studio Pro switch storage (#1903)", () => {
  it("is off by default and remembers the switch per device", () => {
    const storage = memoryStorage();
    expect(readProMode(storage)).toBe(false);
    writeProMode(true, storage);
    expect(storage.values.get(PRO_MODE_STORAGE_KEY)).toBe("on");
    expect(readProMode(storage)).toBe(true);
    writeProMode(false, storage);
    expect(readProMode(storage)).toBe(false);
  });

  it("fails silently without storage or when storage throws", () => {
    expect(readProMode(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readProMode(broken)).toBe(false);
    expect(() => writeProMode(true, broken)).not.toThrow();
    const storage = memoryStorage();
    storage.setItem(PRO_MODE_STORAGE_KEY, "garbage");
    expect(readProMode(storage)).toBe(false);
  });

  it("offers Pro only when the server's entitlement allows it", () => {
    const decision = (allowed: boolean) => ({
      pro: { allowed, reason: "r", policyVersion: "v" },
    });
    expect(proModeAllowed({ entitlements: decision(true) })).toBe(true);
    expect(proModeAllowed({ entitlements: decision(false) })).toBe(false);
    expect(proModeAllowed({})).toBe(false);
  });
});
