import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getX402ChainId } from './x402.public';

export type X402LicenseKey = 'personal' | 'remix' | 'commercial';

export type X402LicensePricing = Record<X402LicenseKey, {
  amountUsd: number;
  feeBps: number;
}>;

const DEFAULT_TESTNET_FACILITATOR_URL = 'https://x402.org/facilitator';
const DEFAULT_TESTNET_NETWORK = 'eip155:84532';
const DEFAULT_BASE_MAINNET_RPC_URL = 'https://mainnet.base.org';
const DEFAULT_BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
const DEFAULT_LOCAL_RPC_URL = 'http://localhost:8545';
const DEFAULT_X402_LICENSE_PRICING: X402LicensePricing = {
  personal: { amountUsd: 0.05, feeBps: 1500 },
  remix: { amountUsd: 5, feeBps: 1000 },
  commercial: { amountUsd: 25, feeBps: 1000 },
};

/**
 * x402 Configuration — reads env vars for the x402 payment layer.
 *
 * Required env vars (when X402_ENABLED=true):
 *   X402_PAYOUT_ADDRESS  — wallet address receiving USDC payments
 *
 * Optional env vars:
 *   X402_FACILITATOR_URL — facilitator endpoint (defaults to the x402 testnet facilitator)
 *   X402_NETWORK         — CAIP-2 chain identifier (default: Base Sepolia)
 *   X402_RPC_URL         — RPC used to verify in-app smart-account payments
 *   X402_CONTRACT_SETTLEMENT_ENABLED — execute marketplace settlement for listed stems
 *   X402_SETTLEMENT_PRIVATE_KEY — settlement wallet key; must control X402_PAYOUT_ADDRESS
 *   X402_*_PRICE_USD / X402_*_FEE_BPS — x402 license defaults and take-rates
 *   X402_ENABLED         — feature flag (default: false)
 */
@Injectable()
export class X402Config {
  private readonly logger = new Logger(X402Config.name);

  /** Whether x402 payment endpoints are active */
  readonly enabled: boolean;

  /** Wallet address that receives USDC payments */
  readonly payoutAddress: string;

  /** x402 facilitator URL for verify/settle */
  readonly facilitatorUrl: string;

  /** CAIP-2 network identifier (e.g., eip155:84532 for Base Sepolia) */
  readonly network: string;

  /** Numeric chain id derived from the CAIP-2 network identifier */
  readonly chainId: number;

  /** RPC used by smart-account x402 verification */
  readonly rpcUrl: string;

  /** Whether listed x402 stems should execute marketplace settlement before download */
  readonly contractSettlementEnabled: boolean;

  /** Private key for the x402 settlement wallet. Secret; never log. */
  readonly settlementPrivateKey: `0x${string}` | null;

  /** Canonical x402 license defaults and off-chain facilitator take-rates. */
  readonly licensePricing: X402LicensePricing;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('X402_ENABLED') === 'true';
    const configuredFacilitator = this.config.get<string>('X402_FACILITATOR_URL');
    const settlementPrivateKey = this.config.get<string>('X402_SETTLEMENT_PRIVATE_KEY')?.trim();

    this.payoutAddress =
      this.config.get<string>('X402_PAYOUT_ADDRESS') || '';

    this.facilitatorUrl =
      configuredFacilitator || DEFAULT_TESTNET_FACILITATOR_URL;

    this.network =
      this.config.get<string>('X402_NETWORK') || DEFAULT_TESTNET_NETWORK;
    this.chainId = getX402ChainId(this.network);
    this.rpcUrl = this.resolveRpcUrl();
    this.contractSettlementEnabled =
      this.config.get<string>('X402_CONTRACT_SETTLEMENT_ENABLED') === 'true';
    this.settlementPrivateKey = settlementPrivateKey
      ? this.normalizePrivateKey(settlementPrivateKey)
      : null;
    // Facilitator-mode settlements carry the take-rate as off-chain accounting;
    // contract-settlement mode uses the marketplace contract's on-chain split.
    this.licensePricing = {
      personal: {
        amountUsd: this.getPositiveNumber('X402_PERSONAL_PRICE_USD', DEFAULT_X402_LICENSE_PRICING.personal.amountUsd),
        feeBps: this.getBps('X402_PERSONAL_FEE_BPS', DEFAULT_X402_LICENSE_PRICING.personal.feeBps),
      },
      remix: {
        amountUsd: this.getPositiveNumber('X402_REMIX_LICENSE_USD', DEFAULT_X402_LICENSE_PRICING.remix.amountUsd),
        feeBps: this.getBps('X402_REMIX_FEE_BPS', DEFAULT_X402_LICENSE_PRICING.remix.feeBps),
      },
      commercial: {
        amountUsd: this.getPositiveNumber('X402_COMMERCIAL_LICENSE_USD', DEFAULT_X402_LICENSE_PRICING.commercial.amountUsd),
        feeBps: this.getBps('X402_COMMERCIAL_FEE_BPS', DEFAULT_X402_LICENSE_PRICING.commercial.feeBps),
      },
    };

    if (this.enabled) {
      if (!this.payoutAddress) {
        throw new Error(
          'X402_PAYOUT_ADDRESS is required when X402_ENABLED=true',
        );
      }
      if (this.network === 'eip155:8453' && !configuredFacilitator) {
        throw new Error(
          'X402_FACILITATOR_URL must be set explicitly for Base mainnet x402 payments',
        );
      }
      if (this.contractSettlementEnabled && !this.settlementPrivateKey) {
        throw new Error(
          'X402_SETTLEMENT_PRIVATE_KEY is required when X402_CONTRACT_SETTLEMENT_ENABLED=true',
        );
      }
      this.logger.log(
        `x402 enabled — network: ${this.network}, payout: ${this.payoutAddress.slice(0, 6)}...${this.payoutAddress.slice(-4)}`,
      );
    } else {
      this.logger.log('x402 disabled (set X402_ENABLED=true to activate)');
    }
  }

  private resolveRpcUrl() {
    const explicitRpc = this.config.get<string>('X402_RPC_URL')?.trim();
    if (explicitRpc) return explicitRpc;

    if (this.chainId === 84532) {
      return (
        this.config.get<string>('BASE_SEPOLIA_RPC_URL')?.trim() ||
        DEFAULT_BASE_SEPOLIA_RPC_URL
      );
    }
    if (this.chainId === 8453) {
      return DEFAULT_BASE_MAINNET_RPC_URL;
    }
    if (this.chainId === 31337) {
      return (
        this.config.get<string>('LOCAL_RPC_URL')?.trim() ||
        DEFAULT_LOCAL_RPC_URL
      );
    }
    return '';
  }

  private normalizePrivateKey(value: string): `0x${string}` {
    const normalized = value.startsWith('0x') ? value : `0x${value}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
      throw new Error('X402_SETTLEMENT_PRIVATE_KEY must be a 32-byte hex private key');
    }
    return normalized as `0x${string}`;
  }

  resolveLicenseAmountUsd(
    pricing: {
      basePlayPriceUsd?: number | null;
      remixLicenseUsd?: number | null;
      commercialLicenseUsd?: number | null;
    } | null | undefined,
    licenseType: X402LicenseKey,
  ) {
    if (licenseType === 'remix') {
      return pricing?.remixLicenseUsd ?? this.licensePricing.remix.amountUsd;
    }
    if (licenseType === 'commercial') {
      return pricing?.commercialLicenseUsd ?? this.licensePricing.commercial.amountUsd;
    }
    return pricing?.basePlayPriceUsd ?? this.licensePricing.personal.amountUsd;
  }

  private getPositiveNumber(name: string, fallback: number): number {
    const raw = this.config.get<string>(name)?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return value;
  }

  private getBps(name: string, fallback: number): number {
    const raw = this.config.get<string>(name)?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
      throw new Error(`${name} must be an integer between 0 and 10000`);
    }
    return value;
  }
}
