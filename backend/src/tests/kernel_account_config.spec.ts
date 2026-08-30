import {
  assertAaKernelVersion,
  resolveAaChain,
  resolveAaEntryPoint,
  resolveAaFunderKey,
} from "../modules/identity/kernel_account.service";

describe("Kernel account custom-chain configuration", () => {
  it("preserves a custom chain ID and RPC URL", () => {
    const chain = resolveAaChain(3_151_908, "http://127.0.0.1:32000");

    expect(chain.id).toBe(3_151_908);
    expect(chain.rpcUrls.default.http).toEqual(["http://127.0.0.1:32000"]);
  });

  it("rejects invalid chain IDs", () => {
    expect(() => resolveAaChain(0, "http://127.0.0.1:8545")).toThrow(
      "AA_CHAIN_ID must be a positive safe integer",
    );
  });

  it("uses the deployed local EntryPoint instead of the canonical address", () => {
    expect(resolveAaEntryPoint(31337)).toEqual({
      address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      version: "0.7",
    });
  });

  it("requires and preserves the EntryPoint for a custom chain", () => {
    const address = "0x1111111111111111111111111111111111111111";
    expect(resolveAaEntryPoint(3_151_908, address)).toEqual({
      address,
      version: "0.7",
    });
    expect(() => resolveAaEntryPoint(3_151_908)).toThrow(
      "AA_ENTRY_POINT is required for custom chain 3151908",
    );
  });

  it("uses the well-known development key only on plain Anvil", () => {
    expect(resolveAaFunderKey(31337)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(resolveAaFunderKey(3_151_908)).toBeNull();
  });

  it("accepts an explicit isolated-devnet funder key", () => {
    const key = "11".repeat(32);
    expect(resolveAaFunderKey(3_151_908, key)).toBe(`0x${key}`);
  });

  it("rejects malformed funder keys before creating a signer", () => {
    expect(() => resolveAaFunderKey(3_151_908, "0x1234")).toThrow(
      "AA_FUNDER_KEY must be a 32-byte hexadecimal private key",
    );
  });

  it("rejects configuration for a different Kernel account surface", () => {
    expect(assertAaKernelVersion()).toBe("0.3.1");
    expect(() => assertAaKernelVersion("0.3.2")).toThrow(
      "AA_KERNEL_VERSION must be 0.3.1; received 0.3.2",
    );
  });
});
