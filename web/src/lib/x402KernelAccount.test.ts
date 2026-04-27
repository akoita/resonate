import { describe, expect, it } from "vitest";
import { resetX402KernelAccountCache } from "./x402KernelAccount";
import { getKernelAccountConfig } from "./accountAbstraction";

describe("getKernelAccountConfig - Base Sepolia branch", () => {
  it("returns the Kernel V3.1 metaFactory + canonical EntryPoint for chain 84532", () => {
    const cfg = getKernelAccountConfig(84532);
    expect(cfg.entryPoint).toEqual({
      address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      version: "0.7",
    });
    expect(cfg.factoryAddress).toBe(
      "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
    );
  });

  it("does not let env vars override the Base Sepolia defaults", () => {
    const before = process.env.NEXT_PUBLIC_AA_FACTORY;
    process.env.NEXT_PUBLIC_AA_FACTORY = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    try {
      const cfg = getKernelAccountConfig(84532);
      expect(cfg.factoryAddress).toBe(
        "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
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
