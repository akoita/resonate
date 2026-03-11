import { describe, it, expect } from "vitest";
import {
  toError,
  extractRevertData,
  normalizeContractWriteError,
  formatBatchErrorMessage,
} from "../contractErrors";
import { encodeErrorResult } from "viem";
import { knownContractErrorAbi } from "../contractErrors";

// ============ toError ============

describe("toError", () => {
  it("returns the same Error when given an Error", () => {
    const original = new Error("test");
    expect(toError(original)).toBe(original);
  });

  it("wraps a string into an Error", () => {
    const result = toError("plain string");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("plain string");
  });

  it("wraps a number into an Error", () => {
    const result = toError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("42");
  });

  it("wraps null into an Error", () => {
    const result = toError(null);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("null");
  });

  it("wraps undefined into an Error", () => {
    const result = toError(undefined);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("undefined");
  });
});

// ============ extractRevertData ============

describe("extractRevertData", () => {
  it("extracts hex from 'simulation with reason: 0x…'", () => {
    const msg = "UserOperation failed simulation with reason: 0xabcdef01";
    expect(extractRevertData(msg)).toBe("0xabcdef01");
  });

  it("extracts hex from 'reverted with reason: 0x…'", () => {
    const msg = "Transaction reverted with reason: 0x1234ABCD";
    expect(extractRevertData(msg)).toBe("0x1234ABCD");
  });

  it("extracts hex from 'execution reverted with reason: 0x…'", () => {
    const msg = "The contract execution reverted with reason: 0xdeadbeef";
    expect(extractRevertData(msg)).toBe("0xdeadbeef");
  });

  it("returns null when there is no hex data", () => {
    expect(extractRevertData("some random error without hex")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractRevertData("")).toBeNull();
  });

  it("picks the first match when multiple patterns appear", () => {
    const msg =
      "simulation with reason: 0xAAAA | also reverted with reason: 0xBBBB";
    expect(extractRevertData(msg)).toBe("0xAAAA");
  });

  it("is case-insensitive on hex digits", () => {
    const msg = "Simulation With Reason: 0xAbCdEf99";
    expect(extractRevertData(msg)).toBe("0xAbCdEf99");
  });
});

// ============ normalizeContractWriteError ============

describe("normalizeContractWriteError", () => {
  // NotAttested(uint256 tokenId) — selector 0x4a0bfec1
  const notAttestedData = encodeErrorResult({
    abi: knownContractErrorAbi,
    errorName: "NotAttested",
    args: [BigInt(1)],
  });

  // MarketplaceNotApproved() — no args
  const marketplaceNotApprovedData = encodeErrorResult({
    abi: knownContractErrorAbi,
    errorName: "MarketplaceNotApproved",
  });

  it("decodes NotAttested and produces a human-readable message", () => {
    const raw = new Error(
      `UserOp failed simulation with reason: ${notAttestedData} Request Arguments: { to: 0x… }`
    );
    const result = normalizeContractWriteError(raw);
    expect(result.message).toContain("release protection record #1");
    expect(result.message).toContain("attested on-chain");
  });

  it("decodes MarketplaceNotApproved", () => {
    const raw = new Error(
      `Transaction reverted with reason: ${marketplaceNotApprovedData}`
    );
    const result = normalizeContractWriteError(raw);
    expect(result.message).toBe("Marketplace approval is missing for this Stem NFT.");
  });

  it("strips ' Request Arguments:' suffix even without revert data", () => {
    const raw = new Error("Something went wrong Request Arguments: { gas: 1000 }");
    const result = normalizeContractWriteError(raw);
    expect(result.message).toBe("Something went wrong");
  });

  it("falls back to 'Transaction failed' for an empty message", () => {
    const result = normalizeContractWriteError(new Error(""));
    expect(result.message).toBe("Transaction failed");
  });

  it("handles non-Error inputs", () => {
    const result = normalizeContractWriteError("kaboom");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("kaboom");
  });

  it("handles unknown hex that doesn't match known ABI", () => {
    const raw = new Error("simulation with reason: 0xff112233");
    const result = normalizeContractWriteError(raw);
    // Should fall back to trimmed message since the hex doesn't decode
    expect(result.message).toContain("simulation with reason");
  });
});

// ============ formatBatchErrorMessage ============

describe("formatBatchErrorMessage", () => {
  it("strips ' Request Arguments:' and everything after", () => {
    const msg = "Something broke Request Arguments: { to: 0x }";
    expect(formatBatchErrorMessage(msg)).toBe("Something broke");
  });

  it("returns the full message when under 280 chars", () => {
    const msg = "Short error message";
    expect(formatBatchErrorMessage(msg)).toBe("Short error message");
  });

  it("truncates messages over 280 characters with ellipsis", () => {
    const longMsg = "A".repeat(300);
    const result = formatBatchErrorMessage(longMsg);
    expect(result.length).toBe(280);
    expect(result.endsWith("...")).toBe(true);
    expect(result).toBe("A".repeat(277) + "...");
  });

  it("exactly 280 chars is NOT truncated", () => {
    const msg = "X".repeat(280);
    expect(formatBatchErrorMessage(msg)).toBe(msg);
  });

  it("281 chars IS truncated", () => {
    const msg = "Y".repeat(281);
    const result = formatBatchErrorMessage(msg);
    expect(result.length).toBe(280);
  });

  it("strips Request Arguments first, then truncates", () => {
    const longPrefix = "Z".repeat(300);
    const msg = `${longPrefix} Request Arguments: { big: true }`;
    const result = formatBatchErrorMessage(msg);
    expect(result.length).toBe(280);
    expect(result.endsWith("...")).toBe(true);
    // Verify the Request Arguments part is gone
    expect(result).not.toContain("Request Arguments");
  });
});
