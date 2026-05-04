import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getX402ChainId } from './x402.public';

const DEFAULT_TESTNET_FACILITATOR_URL = 'https://x402.org/facilitator';
const DEFAULT_TESTNET_NETWORK = 'eip155:84532';
const DEFAULT_BASE_MAINNET_RPC_URL = 'https://mainnet.base.org';
const DEFAULT_BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';
const DEFAULT_LOCAL_RPC_URL = 'http://localhost:8545';

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

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('X402_ENABLED') === 'true';
    const configuredFacilitator = this.config.get<string>('X402_FACILITATOR_URL');

    this.payoutAddress =
      this.config.get<string>('X402_PAYOUT_ADDRESS') || '';

    this.facilitatorUrl =
      configuredFacilitator || DEFAULT_TESTNET_FACILITATOR_URL;

    this.network =
      this.config.get<string>('X402_NETWORK') || DEFAULT_TESTNET_NETWORK;
    this.chainId = getX402ChainId(this.network);
    this.rpcUrl = this.resolveRpcUrl();

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
}
