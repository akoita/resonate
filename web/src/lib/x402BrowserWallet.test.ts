import { describe, expect, it } from "vitest";
import { base, baseSepolia } from "viem/chains";
import { getX402Chain, getX402ChainName } from "./x402BrowserWallet";

describe("getX402Chain", () => {
  it("resolves Base Sepolia from the public x402 chain id", () => {
    expect(getX402Chain(84532).id).toBe(baseSepolia.id);
  });

  it("resolves Base mainnet from the public x402 chain id", () => {
    expect(getX402Chain(8453).id).toBe(base.id);
  });

  it("fails closed for unknown chains without an explicit browser RPC URL", () => {
    expect(() => getX402Chain(999999)).toThrow("NEXT_PUBLIC_X402_RPC_URL");
  });
});

describe("getX402ChainName", () => {
  it("returns user-facing network names for supported x402 chains", () => {
    expect(getX402ChainName(84532)).toBe("Base Sepolia");
    expect(getX402ChainName(8453)).toBe("Base");
    expect(getX402ChainName(999999)).toBe("chain 999999");
  });
});
