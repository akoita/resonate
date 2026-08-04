import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChainExplorerAddressUrl, getChainExplorerContractUrl } from "./explorer";

const ADDRESS = "0xd7035cf620c09653542b75a9b95bbec1514d8b23";

describe("getChainExplorerAddressUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("uses the configured explorer when its chain matches the requested chain", () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "https://base-sepolia.blockscout.com/");

    expect(getChainExplorerAddressUrl(84532, ADDRESS)).toBe(
      `https://base-sepolia.blockscout.com/address/${ADDRESS}`,
    );
  });

  it("keeps chain metadata when the configured explorer belongs to another chain", () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "https://base-sepolia.blockscout.com");

    expect(getChainExplorerAddressUrl(11155111, ADDRESS)).toBe(
      `https://sepolia.etherscan.io/address/${ADDRESS}`,
    );
  });

  it("falls back to chain metadata when the matching configured explorer is malformed", () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "javascript:alert(1)");

    expect(getChainExplorerAddressUrl(84532, ADDRESS)).toBe(
      `https://sepolia.basescan.org/address/${ADDRESS}`,
    );
  });

  it("does not apply an explorer override with a malformed configured chain ID", () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532junk");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "https://base-sepolia.blockscout.com");

    expect(getChainExplorerAddressUrl(84532, ADDRESS)).toBe(
      `https://sepolia.basescan.org/address/${ADDRESS}`,
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

describe("getChainExplorerContractUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens Blockscout on the verified contract tab", () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "https://base-sepolia.blockscout.com");

    expect(getChainExplorerContractUrl(84532, ADDRESS)).toBe(
      `https://base-sepolia.blockscout.com/address/${ADDRESS}?tab=contract`,
    );
  });

  it("does not add Blockscout parameters to other explorer providers", () => {
    expect(getChainExplorerContractUrl(84532, ADDRESS)).toBe(
      `https://sepolia.basescan.org/address/${ADDRESS}`,
    );
  });

  it("does not treat a deceptive hostname as official Blockscout", () => {
    expect(
      getChainExplorerContractUrl(999999, ADDRESS, "https://evilblockscout.example"),
    ).toBe(`https://evilblockscout.example/address/${ADDRESS}`);
  });

  it("returns no contract link for local chains or missing addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "31337");
    vi.stubEnv("NEXT_PUBLIC_EXPLORER_URL", "https://local.blockscout.com");

    expect(getChainExplorerContractUrl(31337, ADDRESS)).toBeUndefined();
    expect(getChainExplorerContractUrl(84532, undefined)).toBeUndefined();
  });
});
