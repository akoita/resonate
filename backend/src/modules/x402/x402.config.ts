import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * x402 Configuration — reads env vars for the x402 payment layer.
 *
 * Required env vars (when X402_ENABLED=true):
 *   X402_PAYOUT_ADDRESS  — wallet address receiving USDC payments
 *
 * Optional env vars:
 *   X402_FACILITATOR_URL — facilitator endpoint (default: testnet)
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

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('X402_ENABLED') === 'true';

    this.payoutAddress =
      this.config.get<string>('X402_PAYOUT_ADDRESS') || '';

    this.facilitatorUrl =
      this.config.get<string>('X402_FACILITATOR_URL') ||
      'https://x402.org/facilitator';

    this.network =
      this.config.get<string>('X402_NETWORK') || 'eip155:84532'; // Base Sepolia

    if (this.enabled) {
      if (!this.payoutAddress) {
        throw new Error(
          'X402_PAYOUT_ADDRESS is required when X402_ENABLED=true',
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
