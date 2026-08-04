import { describe, expect, it } from "vitest";
import { getChainExplorerAddressUrl } from "./explorer";

const ADDRESS = "0xd7035cf620c09653542b75a9b95bbec1514d8b23";

describe("getChainExplorerAddressUrl", () => {
  it("uses the recorded Base Sepolia explorer", () => {
    expect(getChainExplorerAddressUrl(84532, ADDRESS)).toBe(
      `https://sepolia.basescan.org/address/${ADDRESS}`,
    );
  });

  it("uses the recorded Ethereum Sepolia explorer", () => {
    expect(getChainExplorerAddressUrl(11155111, ADDRESS)).toBe(
      `https://sepolia.etherscan.io/address/${ADDRESS}`,
    );
  });

  it.each([
    ["explorer root", "https://explorer.example/", `https://explorer.example/address/${ADDRESS}`],
    ["legacy address base", "https://explorer.example/address///", `https://explorer.example/address/${ADDRESS}`],
  ])("normalizes an unknown-chain fallback supplied as an %s", (_label, fallback, expected) => {
    expect(getChainExplorerAddressUrl(999999, ADDRESS, fallback)).toBe(expected);
  });

  it.each([
    "//attacker.example",
    "/relative-explorer",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:password@explorer.example",
  ])("rejects an unsafe explorer fallback: %s", (fallback) => {
    expect(getChainExplorerAddressUrl(999999, ADDRESS, fallback)).toBeUndefined();
  });

  it("returns no link for local chains even when a fallback is configured", () => {
    expect(getChainExplorerAddressUrl(31337, ADDRESS, "https://explorer.example")).toBeUndefined();
    expect(getChainExplorerAddressUrl(1337, ADDRESS, "https://explorer.example")).toBeUndefined();
  });

  it("returns no link for an unknown chain without a fallback", () => {
    expect(getChainExplorerAddressUrl(999999, ADDRESS)).toBeUndefined();
  });

  it("returns no link when the address is missing", () => {
    expect(getChainExplorerAddressUrl(84532, undefined)).toBeUndefined();
    expect(getChainExplorerAddressUrl(84532, null)).toBeUndefined();
    expect(getChainExplorerAddressUrl(84532, "")).toBeUndefined();
  });
});
