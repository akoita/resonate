import { describe, expect, it } from "vitest";
import { resetX402KernelAccountCache } from "./x402KernelAccount";
import { getKernelAccountConfig } from "./accountAbstraction";

describe("getKernelAccountConfig - Base chain branches", () => {
  it("returns the canonical Kernel V3.1 factory + EntryPoint for chain 84532", () => {
    const cfg = getKernelAccountConfig(84532);
    expect(cfg.entryPoint).toEqual({
      address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      version: "0.7",
    });
    // Same canonical factory as Sepolia — Kernel V3.1 contracts are deployed
    // deterministically on every chain ZeroDev supports, so this is correct
    // for Base Sepolia too.
    expect(cfg.factoryAddress).toBe(
      "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
    );
  });

  it("returns the canonical Kernel V3.1 factory + EntryPoint for Base mainnet", () => {
    const cfg = getKernelAccountConfig(8453);
    expect(cfg.entryPoint).toEqual({
      address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      version: "0.7",
    });
    expect(cfg.factoryAddress).toBe(
      "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
    );
  });

  it("does not let env vars override the Base Sepolia defaults", () => {
    const before = process.env.NEXT_PUBLIC_AA_FACTORY;
    process.env.NEXT_PUBLIC_AA_FACTORY = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    try {
      const cfg = getKernelAccountConfig(84532);
      expect(cfg.factoryAddress).toBe(
        "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
      );
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_AA_FACTORY;
      else process.env.NEXT_PUBLIC_AA_FACTORY = before;
    }
  });

  it("still respects env overrides for the Sepolia branch", () => {
    const before = process.env.NEXT_PUBLIC_AA_FACTORY;
    process.env.NEXT_PUBLIC_AA_FACTORY = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    try {
      const cfg = getKernelAccountConfig(11155111);
      expect(cfg.factoryAddress).toBe(
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      );
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_AA_FACTORY;
      else process.env.NEXT_PUBLIC_AA_FACTORY = before;
    }
  });
});

describe("resetX402KernelAccountCache", () => {
  it("is callable without args (used in tests + after sign-out)", () => {
    expect(() => resetX402KernelAccountCache()).not.toThrow();
  });
});
