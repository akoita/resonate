import { describe, it, expect } from "vitest";
import { formatPrice, parsePrice, formatRoyaltyBps, isZeroAddress, getContractAddresses } from "../contracts";
import type { Address } from "viem";

// ============ Pure Utility Function Tests ============

describe("formatPrice", () => {
    it("formats 1 ETH", () => {
        expect(formatPrice(1000000000000000000n)).toBe("1");
    });

    it("formats fractional ETH", () => {
        expect(formatPrice(500000000000000000n)).toBe("0.5");
    });

    it("formats zero", () => {
        expect(formatPrice(0n)).toBe("0");
    });

    it("formats small amounts (wei)", () => {
        const result = formatPrice(1n);
        expect(result).toBe("0.000000000000000001");
    });

    it("formats large amounts", () => {
        expect(formatPrice(100000000000000000000n)).toBe("100");
    });
});

describe("parsePrice", () => {
    it("parses 1 ETH", () => {
        expect(parsePrice("1")).toBe(1000000000000000000n);
    });

    it("parses fractional ETH", () => {
        expect(parsePrice("0.5")).toBe(500000000000000000n);
    });

    it("parses zero", () => {
        expect(parsePrice("0")).toBe(0n);
    });

    it("round-trips with formatPrice", () => {
        const original = 1234567890000000000n;
        const formatted = formatPrice(original);
        expect(parsePrice(formatted)).toBe(original);
    });
});

describe("formatRoyaltyBps", () => {
    it("formats 500 bps as 5%", () => {
        expect(formatRoyaltyBps(500n)).toBe("5%");
    });

    it("formats 1000 bps as 10%", () => {
        expect(formatRoyaltyBps(1000n)).toBe("10%");
    });

    it("formats 250 bps as 2.5%", () => {
        expect(formatRoyaltyBps(250n)).toBe("2.5%");
    });

    it("formats 0 bps as 0%", () => {
        expect(formatRoyaltyBps(0n)).toBe("0%");
    });
});

describe("isZeroAddress", () => {
    it("returns true for zero address", () => {
        expect(isZeroAddress("0x0000000000000000000000000000000000000000" as Address)).toBe(true);
    });

    it("returns false for non-zero address", () => {
        expect(isZeroAddress("0x1234567890abcdef1234567890abcdef12345678" as Address)).toBe(false);
    });

    it("returns false for checksummed non-zero address", () => {
        expect(isZeroAddress("0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" as Address)).toBe(false);
    });
});

describe("getContractAddresses", () => {
    it("returns addresses for local chain (31337)", () => {
        const addresses = getContractAddresses(31337);
        expect(addresses).toBeDefined();
        expect(addresses.stemNFT).toBeDefined();
        expect(addresses.marketplace).toBeDefined();
    });

    it("throws for unconfigured chain (Sepolia 11155111)", () => {
        expect(() => getContractAddresses(11155111)).toThrow("No contract addresses");
    });

    it("returns addresses for Base Sepolia (84532)", () => {
        const addresses = getContractAddresses(84532);
        expect(addresses).toBeDefined();
        expect(addresses.stemNFT).toBeDefined();
    });
});
