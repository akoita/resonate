/**
 * configuredShowCampaignEscrowAddress (#947) — unit (no DB).
 *
 * The backend discovers the deployed ShowCampaignEscrow address per chain from
 * deployment-handoff env config, with a chain-agnostic fallback, and fails
 * closed (null) for unset / malformed / zero addresses.
 */

import { configuredShowCampaignEscrowAddress } from "../modules/shows/shows.service";

const ENV_KEYS = [
  "SHOW_CAMPAIGN_ESCROW_ADDRESS",
  "SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS",
  "BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS",
  "ARBITRUM_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS",
];

const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("configuredShowCampaignEscrowAddress (#947)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns null when no escrow address is configured", () => {
    expect(configuredShowCampaignEscrowAddress(84532)).toBeNull();
  });

  it("prefers the chain-specific env over the chain-agnostic fallback", () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ADDR_A;
    process.env.BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS = ADDR_B;
    expect(configuredShowCampaignEscrowAddress(84532)).toBe(ADDR_B);
  });

  it("falls back to the chain-agnostic env when no chain-specific value is set", () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ADDR_A;
    expect(configuredShowCampaignEscrowAddress(11155111)).toBe(ADDR_A);
    expect(configuredShowCampaignEscrowAddress(31337)).toBe(ADDR_A);
  });

  it("reads the local Anvil chain from SHOW_CAMPAIGN_ESCROW_ADDRESS", () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ADDR_A;
    expect(configuredShowCampaignEscrowAddress(31337)).toBe(ADDR_A);
  });

  it("fails closed for the zero address", () => {
    process.env.BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS = ZERO;
    expect(configuredShowCampaignEscrowAddress(84532)).toBeNull();
  });

  it("fails closed for a malformed address", () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = "0xnope";
    expect(configuredShowCampaignEscrowAddress(84532)).toBeNull();
  });

  it("uses the chain-agnostic fallback for an unknown chain id", () => {
    process.env.SHOW_CAMPAIGN_ESCROW_ADDRESS = ADDR_A;
    expect(configuredShowCampaignEscrowAddress(999999)).toBe(ADDR_A);
  });
});
