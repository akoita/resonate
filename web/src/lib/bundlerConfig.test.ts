import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBundlerUrl,
  getPimlicoBundlerUrl,
  getServerBundlerChainId,
  getServerBundlerTarget,
  isLocalDevEnvironment,
  isPaymasterEnabled,
} from "./bundlerConfig";

const envKeys = [
  "NEXT_PUBLIC_RPC_URL",
  "NEXT_PUBLIC_AA_BUNDLER",
  "NEXT_PUBLIC_PIMLICO_API_KEY",
  "NEXT_PUBLIC_CHAIN_ID",
  "NEXT_PUBLIC_AA_PAYMASTER_ENABLED",
  "CHAIN_ID",
  "ALTO_BUNDLER_URL",
  "AA_BUNDLER",
  "PIMLICO_API_KEY",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of envKeys) {
    const originalValue = originalEnv[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe("isLocalDevEnvironment", () => {
  it("treats chain 31337 as local", () => {
    expect(isLocalDevEnvironment(31337)).toBe(true);
  });

  it("treats localhost RPC overrides as local", () => {
    expect(isLocalDevEnvironment(11155111, "http://localhost:8545")).toBe(true);
    expect(isLocalDevEnvironment(11155111, "http://127.0.0.1:8545")).toBe(true);
  });

  it("treats public Sepolia RPC as non-local", () => {
    expect(isLocalDevEnvironment(11155111, "https://sepolia.drpc.org")).toBe(false);
  });
});

describe("getPimlicoBundlerUrl", () => {
  it("returns null when the api key is blank", () => {
    expect(getPimlicoBundlerUrl(11155111, "")).toBeNull();
    expect(getPimlicoBundlerUrl(11155111, "   ")).toBeNull();
  });

  it("returns the Pimlico URL when an api key is set", () => {
    expect(getPimlicoBundlerUrl(11155111, "test-key")).toBe(
      "https://api.pimlico.io/v2/11155111/rpc?apikey=test-key",
    );
  });
});

describe("getBundlerUrl", () => {
  it("prefers a public bundler override", () => {
    process.env.NEXT_PUBLIC_AA_BUNDLER = "https://bundler.example/rpc";
    expect(getBundlerUrl(11155111)).toBe("https://bundler.example/rpc");
  });

  it("uses the local proxy for local dev", () => {
    process.env.NEXT_PUBLIC_RPC_URL = "http://localhost:8545";
    expect(getBundlerUrl(11155111)).toBe("/api/bundler");
  });

  it("uses Pimlico when a public api key is configured", () => {
    process.env.NEXT_PUBLIC_PIMLICO_API_KEY = "public-key";
    expect(getBundlerUrl(11155111)).toBe(
      "https://api.pimlico.io/v2/11155111/rpc?apikey=public-key",
    );
  });

  it("falls back to the server proxy when no public cloud bundler config exists", () => {
    expect(getBundlerUrl(11155111)).toBe("/api/bundler");
  });
});

describe("isPaymasterEnabled", () => {
  it("defaults to self-pay", () => {
    expect(isPaymasterEnabled(84532)).toBe(false);
  });

  it("uses paymaster only when explicitly enabled", () => {
    process.env.NEXT_PUBLIC_AA_PAYMASTER_ENABLED = "true";
    expect(isPaymasterEnabled(84532)).toBe(true);
  });

  it("never enables paymaster for local environments", () => {
    process.env.NEXT_PUBLIC_AA_PAYMASTER_ENABLED = "true";
    expect(isPaymasterEnabled(31337)).toBe(false);
  });
});

describe("getServerBundlerTarget", () => {
  it("prefers explicit server-side bundler URLs", () => {
    process.env.AA_BUNDLER = "https://server-bundler.example/rpc";
    expect(getServerBundlerTarget(11155111)).toBe("https://server-bundler.example/rpc");
  });

  it("preserves localhost Alto priority for local dev even if a Pimlico key exists", () => {
    process.env.PIMLICO_API_KEY = "secret-key";
    process.env.NEXT_PUBLIC_RPC_URL = "http://localhost:8545";
    expect(getServerBundlerTarget(11155111)).toBe("http://localhost:4337");
  });

  it("can build a server-side Pimlico target without exposing a public key", () => {
    process.env.PIMLICO_API_KEY = "secret-key";
    expect(getServerBundlerTarget(11155111)).toBe(
      "https://api.pimlico.io/v2/11155111/rpc?apikey=secret-key",
    );
  });

  it("returns localhost for local environments", () => {
    process.env.NEXT_PUBLIC_RPC_URL = "http://localhost:8545";
    expect(getServerBundlerTarget(11155111)).toBe("http://localhost:4337");
  });

  it("returns null for non-local environments when no server config exists", () => {
    expect(getServerBundlerTarget(11155111)).toBeNull();
  });
});

describe("getServerBundlerChainId", () => {
  it("prefers the server AA chain over the public frontend chain", () => {
    process.env.AA_CHAIN_ID = "84532";
    process.env.NEXT_PUBLIC_CHAIN_ID = "11155111";
    expect(getServerBundlerChainId()).toBe(84532);
  });

  it("falls back to the public chain when no server runtime chain is configured", () => {
    delete process.env.AA_CHAIN_ID;
    delete process.env.CHAIN_ID;
    process.env.NEXT_PUBLIC_CHAIN_ID = "11155111";
    expect(getServerBundlerChainId()).toBe(11155111);
  });
});
