import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDefaultX402Asset, getX402ChainId } from './x402.public';

const DEFAULT_TESTNET_FACILITATOR_URL = 'https://x402.org/facilitator';
const DEFAULT_TESTNET_NETWORK = 'eip155:84532';

/**
 * x402 Configuration — reads env vars for the x402 payment layer.
 *
 * Required env vars (when X402_ENABLED=true):
 *   X402_PAYOUT_ADDRESS  — wallet address receiving USDC payments
 *
 * Optional env vars:
 *   X402_FACILITATOR_URL — facilitator endpoint (defaults to the x402 testnet facilitator)
 *   X402_NETWORK         — CAIP-2 chain identifier (default: Base Sepolia)
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

    if (this.enabled) {
      if (!this.payoutAddress) {
        throw new Error(
          'X402_PAYOUT_ADDRESS is required when X402_ENABLED=true',
        );
      }
      getDefaultX402Asset(this.network);
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
}
