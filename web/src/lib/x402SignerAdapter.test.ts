import { describe, expect, it, vi } from "vitest";
import {
  createX402KernelSigner,
  maybeWrapErc6492,
  splitInitCode,
} from "./x402SignerAdapter";

const FACTORY = "0x1111111111111111111111111111111111111111" as const;
const SA = "0x2222222222222222222222222222222222222222" as const;
const RAW_SIG = "0x" + "ab".repeat(65) as `0x${string}`;
const FACTORY_CALLDATA = "0xdeadbeef" as `0x${string}`;
const INIT_CODE = (FACTORY + FACTORY_CALLDATA.slice(2)) as `0x${string}`;

const ERC6492_MAGIC = "6492649264926492649264926492649264926492649264926492649264926492";

function makeAccount(overrides: Partial<{
  signature: `0x${string}`;
  initCode: `0x${string}`;
}> = {}) {
  return {
    address: SA,
    factoryAddress: FACTORY,
    signTypedData: vi.fn().mockResolvedValue(overrides.signature ?? RAW_SIG),
    generateInitCode: vi.fn().mockResolvedValue(overrides.initCode ?? INIT_CODE),
  };
}

describe("splitInitCode", () => {
  it("splits the standard ERC-4337 init code into factory + calldata", () => {
    expect(splitInitCode(INIT_CODE, FACTORY)).toEqual({
      factoryAddress: FACTORY,
      factoryCalldata: FACTORY_CALLDATA,
    });
  });

  it("falls back to the declared factory when init code is empty", () => {
    expect(splitInitCode("0x", FACTORY)).toEqual({
      factoryAddress: FACTORY,
      factoryCalldata: "0x",
    });
  });
});

describe("maybeWrapErc6492", () => {
  it("returns the raw signature when the smart account is already deployed", async () => {
    const account = makeAccount();
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue("0x60806040" as const),
    };

    const result = await maybeWrapErc6492({
      account,
      publicClient,
      signature: RAW_SIG,
    });

    expect(result).toBe(RAW_SIG);
    expect(account.generateInitCode).not.toHaveBeenCalled();
  });

  it("wraps in ERC-6492 envelope when the smart account is undeployed", async () => {
    const account = makeAccount();
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue(undefined),
    };

    const result = await maybeWrapErc6492({
      account,
      publicClient,
      signature: RAW_SIG,
    });

    expect(result).not.toBe(RAW_SIG);
    expect(account.generateInitCode).toHaveBeenCalledTimes(1);
    expect(result.toLowerCase().endsWith(ERC6492_MAGIC.toLowerCase())).toBe(true);
    expect(result.toLowerCase()).toContain(FACTORY.slice(2).toLowerCase());
  });

  it("wraps even when bytecode reads as the empty 0x string", async () => {
    const account = makeAccount();
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue("0x" as const),
    };

    const result = await maybeWrapErc6492({
      account,
      publicClient,
      signature: RAW_SIG,
    });

    expect(result).not.toBe(RAW_SIG);
    expect(result.toLowerCase().endsWith(ERC6492_MAGIC.toLowerCase())).toBe(true);
  });
});

describe("createX402KernelSigner", () => {
  it("delegates address and lazily 6492-wraps via signTypedData", async () => {
    const account = makeAccount();
    const publicClient = {
      getBytecode: vi.fn().mockResolvedValue(undefined),
    };
    const signer = createX402KernelSigner({ account, publicClient });

    expect(signer.address).toBe(SA);

    const signed = await signer.signTypedData({
      domain: { name: "USDC", version: "2" },
      types: { Authorization: [] },
      primaryType: "Authorization",
      message: {},
    });

    expect(account.signTypedData).toHaveBeenCalledTimes(1);
    expect(signed.toLowerCase().endsWith(ERC6492_MAGIC.toLowerCase())).toBe(true);
  });
});
