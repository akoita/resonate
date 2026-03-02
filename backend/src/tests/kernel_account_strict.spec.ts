import { KernelAccountService } from "../modules/identity/kernel_account.service";

// Mock viem modules
jest.mock("viem", () => ({
  createPublicClient: () => ({
    getBalance: async () => BigInt("10000000000000000000"),
    waitForTransactionReceipt: async () => ({ blockNumber: 1n }),
  }),
  createWalletClient: () => ({
    sendTransaction: async () => "0xdirect_hash",
  }),
  http: () => ({}),
  keccak256: (data: any) =>
    "0x" + "ab".repeat(32),
  toBytes: (s: string) => Buffer.from(s),
  concat: (arr: any[]) => Buffer.concat(arr.map((x: any) => Buffer.from(x))),
}));

jest.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0xSignerAddress" as const,
  }),
}));

jest.mock("viem/chains", () => ({
  sepolia: { id: 11155111, name: "sepolia", rpcUrls: { default: { http: [] } } },
  foundry: { id: 31337, name: "foundry", rpcUrls: { default: { http: [] } } },
}));

// Mock ZeroDev SDK dynamic imports
jest.mock("@zerodev/sdk", () => ({
  constants: {
    getEntryPoint: () => ({ address: "0xEntryPoint" }),
    KERNEL_V3_1: "0.3.1",
  },
  createKernelAccount: async () => ({ address: "0xSmartAccount" }),
  createKernelAccountClient: () => ({
    sendTransaction: async () => {
      throw new Error("bundler unavailable");
    },
  }),
}), { virtual: true });

jest.mock("@zerodev/ecdsa-validator", () => ({
  signerToEcdsaValidator: async () => ({}),
}), { virtual: true });

function makeService(env: Record<string, string>) {
  const config = {
    get: (key: string) => env[key] ?? undefined,
  };
  return new KernelAccountService(config as any);
}

describe("KernelAccountService strict mode", () => {
  it("falls back to direct send when strict mode is off (default)", async () => {
    const svc = makeService({
      AA_CHAIN_ID: "31337",
      AA_SKIP_BUNDLER: "false",
    });

    // sendTransaction should NOT throw — it falls back to direct EOA send
    const hash = await svc.sendTransaction(
      "user-1",
      "0xTo" as any,
      "0xData" as any,
      BigInt(0),
    );
    expect(hash).toBe("0xdirect_hash");
  });

  it("throws when AA_STRICT_BUNDLER=true and bundler fails", async () => {
    const svc = makeService({
      AA_CHAIN_ID: "31337",
      AA_SKIP_BUNDLER: "false",
      AA_STRICT_BUNDLER: "true",
    });

    await expect(
      svc.sendTransaction("user-1", "0xTo" as any, "0xData" as any, BigInt(0)),
    ).rejects.toThrow("Bundler transaction failed (strict mode)");
  });

  it("throws when AA_STRICT_MODE=true and bundler fails", async () => {
    const svc = makeService({
      AA_CHAIN_ID: "31337",
      AA_SKIP_BUNDLER: "false",
      AA_STRICT_MODE: "true",
    });

    await expect(
      svc.sendTransaction("user-1", "0xTo" as any, "0xData" as any, BigInt(0)),
    ).rejects.toThrow("Bundler transaction failed (strict mode)");
  });

  it("skips bundler entirely when AA_SKIP_BUNDLER=true (non-strict)", async () => {
    const svc = makeService({
      AA_CHAIN_ID: "31337",
      AA_SKIP_BUNDLER: "true",
    });

    const hash = await svc.sendTransaction(
      "user-1",
      "0xTo" as any,
      "0xData" as any,
      BigInt(0),
    );
    // Should use direct send path (no bundler involved)
    expect(hash).toBe("0xdirect_hash");
  });
});
