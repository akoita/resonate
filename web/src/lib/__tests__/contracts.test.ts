import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPrice, parsePrice, formatRoyaltyBps, isZeroAddress, getContractAddresses } from "../contracts";
import type { Address } from "viem";

const CONTRACT_ENV_KEYS = [
    "NEXT_PUBLIC_STEM_NFT_ADDRESS",
    "NEXT_PUBLIC_MARKETPLACE_ADDRESS",
    "NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS",
    "NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS",
    "NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS",
    "NEXT_PUBLIC_CURATION_REWARDS_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_STEM_NFT_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_MARKETPLACE_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_TRANSFER_VALIDATOR_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_CONTENT_PROTECTION_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_DISPUTE_RESOLUTION_ADDRESS",
    "NEXT_PUBLIC_BASE_SEPOLIA_CURATION_REWARDS_ADDRESS",
] as const;

const ORIGINAL_CONTRACT_ENV = Object.fromEntries(
    CONTRACT_ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
    for (const key of CONTRACT_ENV_KEYS) {
        const value = ORIGINAL_CONTRACT_ENV[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    vi.resetModules();
});

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

    it("returns addresses for Sepolia (11155111)", () => {
        const addresses = getContractAddresses(11155111);
        expect(addresses).toBeDefined();
        expect(addresses.stemNFT).toBeDefined();
        expect(addresses.marketplace).toBeDefined();
    });

    it("throws for unconfigured chain", () => {
        expect(() => getContractAddresses(999999)).toThrow("No contract addresses");
    });

    it("returns addresses for Base Sepolia (84532)", () => {
        const addresses = getContractAddresses(84532);
        expect(addresses).toBeDefined();
        expect(addresses.stemNFT).toBeDefined();
    });

    it("uses generic deployment env fallbacks for Base Sepolia", async () => {
        for (const key of CONTRACT_ENV_KEYS) {
            delete process.env[key];
        }

        process.env.NEXT_PUBLIC_STEM_NFT_ADDRESS = "0x1111111111111111111111111111111111111111";
        process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS = "0x2222222222222222222222222222222222222222";
        process.env.NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS = "0x3333333333333333333333333333333333333333";
        process.env.NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS = "0x4444444444444444444444444444444444444444";
        process.env.NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS = "0x5555555555555555555555555555555555555555";
        process.env.NEXT_PUBLIC_CURATION_REWARDS_ADDRESS = "0x6666666666666666666666666666666666666666";

        vi.resetModules();
        const { getAddresses } = await import("../../contracts_abi/index");

        expect(getAddresses(84532)).toEqual({
            stemNFT: "0x1111111111111111111111111111111111111111",
            marketplace: "0x2222222222222222222222222222222222222222",
            transferValidator: "0x3333333333333333333333333333333333333333",
            contentProtection: "0x4444444444444444444444444444444444444444",
            disputeResolution: "0x5555555555555555555555555555555555555555",
            curationRewards: "0x6666666666666666666666666666666666666666",
        });
    });
});
