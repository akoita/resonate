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
    expect(cfg.accountImplementationAddress).toBe(
      "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
    );
    expect(cfg.kernelVersion).toBe("0.3.1");
    expect(cfg.useMetaFactory).toBe(true);
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

describe("getKernelAccountConfig - repository-owned runtimes", () => {
  it("uses the deployed Kernel v3.1 boundary without MetaFactory on local Anvil", () => {
    const cfg = getKernelAccountConfig(31337);

    expect(cfg.accountImplementationAddress).toBe(
      "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    );
    expect(cfg.kernelVersion).toBe("0.3.1");
    expect(cfg.useMetaFactory).toBe(false);
  });

  it("uses explicit deployment handoff values for a custom local chain", () => {
    const previous = {
      entryPoint: process.env.NEXT_PUBLIC_AA_ENTRY_POINT,
      implementation: process.env.NEXT_PUBLIC_AA_KERNEL,
      factory: process.env.NEXT_PUBLIC_AA_FACTORY,
      useMetaFactory: process.env.NEXT_PUBLIC_AA_USE_META_FACTORY,
    };
    process.env.NEXT_PUBLIC_AA_ENTRY_POINT = "0x1111111111111111111111111111111111111111";
    process.env.NEXT_PUBLIC_AA_KERNEL = "0x2222222222222222222222222222222222222222";
    process.env.NEXT_PUBLIC_AA_FACTORY = "0x3333333333333333333333333333333333333333";
    process.env.NEXT_PUBLIC_AA_USE_META_FACTORY = "false";

    try {
      expect(getKernelAccountConfig(3151908)).toMatchObject({
        entryPoint: {
          address: "0x1111111111111111111111111111111111111111",
          version: "0.7",
        },
        accountImplementationAddress: "0x2222222222222222222222222222222222222222",
        factoryAddress: "0x3333333333333333333333333333333333333333",
        kernelVersion: "0.3.1",
        useMetaFactory: false,
      });
    } finally {
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_AA_ENTRY_POINT: previous.entryPoint,
        NEXT_PUBLIC_AA_KERNEL: previous.implementation,
        NEXT_PUBLIC_AA_FACTORY: previous.factory,
        NEXT_PUBLIC_AA_USE_META_FACTORY: previous.useMetaFactory,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("rejects a deployment handoff for a different Kernel version", () => {
    const previous = process.env.NEXT_PUBLIC_AA_KERNEL_VERSION;
    process.env.NEXT_PUBLIC_AA_KERNEL_VERSION = "0.3.2";
    try {
      expect(() => getKernelAccountConfig(31337)).toThrow(
        "Unsupported local Kernel version 0.3.2; expected 0.3.1.",
      );
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_AA_KERNEL_VERSION;
      else process.env.NEXT_PUBLIC_AA_KERNEL_VERSION = previous;
    }
  });
});

describe("resetX402KernelAccountCache", () => {
  it("is callable without args (used in tests + after sign-out)", () => {
    expect(() => resetX402KernelAccountCache()).not.toThrow();
  });
});
