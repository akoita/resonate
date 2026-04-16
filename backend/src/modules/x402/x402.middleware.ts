import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { X402Config } from './x402.config';
import { prisma } from '../../db/prisma';

/**
 * X402Middleware — NestJS adapter for the x402 Express payment middleware.
 *
 * This middleware intercepts requests to x402-protected routes and:
 *   1. Looks up the stem's listing price from the database
 *   2. If no X-PAYMENT header → returns 402 with payment instructions
 *   3. If X-PAYMENT header present → verifies via the facilitator
 *   4. If payment valid → calls next() to let the controller handle the request
 *
 * We implement the x402 protocol directly rather than using @x402/express's
 * paymentMiddleware, because NestJS middleware has a different lifecycle and
 * we need dynamic pricing per-stem from the database.
 */
@Injectable()
export class X402Middleware implements NestMiddleware {
  private readonly logger = new Logger(X402Middleware.name);

  constructor(private readonly x402Config: X402Config) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.x402Config.enabled) {
      return next();
    }

    // Extract stemId from URL: /api/stems/:stemId/x402
    const match = req.path.match(/\/api\/stems\/([^/]+)\/x402$/);
    if (!match) {
      return next();
    }
    const stemId = match[1];

    // Skip the /info sub-route — it's free
    if (req.path.endsWith('/x402/info')) {
      return next();
    }

    // Check for payment header
    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      // No payment — return 402 with payment instructions
      return this.send402(res, stemId);
    }

    // Payment header present — verify with facilitator
    try {
      const isValid = await this.verifyPayment(paymentHeader);
      if (!isValid) {
        this.logger.warn(`Invalid x402 payment for stem ${stemId}`);
        return res.status(402).json({
          error: 'Payment verification failed',
          message: 'The payment proof could not be verified by the facilitator.',
        });
      }

      // Payment verified — settle it
      await this.settlePayment(paymentHeader);
      this.logger.log(`x402 payment verified and settled for stem ${stemId}`);

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`x402 verification error for stem ${stemId}: ${message}`);
      return res.status(500).json({
        error: 'Payment verification error',
        message,
      });
    }
  }

  /**
   * Send a 402 Payment Required response with x402 payment instructions.
   */
  private async send402(res: Response, stemId: string) {
    // Look up the stem's active listing price or StemPricing
    const listing = await prisma.stemListing.findFirst({
      where: {
        stemId: stemId,
        status: 'active',
      },
      orderBy: { listedAt: 'desc' },
    });

    const pricing = await prisma.stemPricing.findUnique({
      where: { stemId },
    });

    // Use StemPricing USD directly, or estimate from listing Wei, or default
    const priceUsd = pricing
      ? `$${pricing.basePlayPriceUsd.toFixed(4)}`
      : listing
        ? this.weiToUsdEstimate(BigInt(listing.pricePerUnit))
        : '$0.05';

    res.status(402).json({
      'x-payment': {
        version: '1',
        scheme: 'exact',
        network: this.x402Config.network,
        payTo: this.x402Config.payoutAddress,
        maxAmountRequired: priceUsd,
        resource: `/api/stems/${stemId}/x402`,
        description: `Purchase stem ${stemId} via x402`,
        mimeType: 'audio/mpeg',
      },
      accepts: [
        {
          scheme: 'exact',
          network: this.x402Config.network,
          price: priceUsd,
          payTo: this.x402Config.payoutAddress,
        },
      ],
    });
  }

  /**
   * Verify payment proof with the x402 facilitator.
   */
  private async verifyPayment(paymentHeader: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.x402Config.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment: paymentHeader }),
      });

      if (!response.ok) {
        this.logger.warn(`Facilitator /verify returned ${response.status}`);
        return false;
      }

      const result = await response.json();
      return result.valid === true;
    } catch (error) {
      this.logger.error(`Facilitator /verify failed: ${error}`);
      return false;
    }
  }

  /**
   * Settle payment with the x402 facilitator.
   */
  private async settlePayment(paymentHeader: string): Promise<void> {
    try {
      const response = await fetch(`${this.x402Config.facilitatorUrl}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment: paymentHeader }),
      });

      if (!response.ok) {
        this.logger.warn(`Facilitator /settle returned ${response.status}`);
      }
    } catch (error) {
      // Settlement failure is logged but doesn't block delivery
      // The facilitator handles eventual settlement
      this.logger.error(`Facilitator /settle failed: ${error}`);
    }
  }

  /**
   * Rough conversion of Wei price to USD string for x402.
   * In production, use a real price feed.
   */
  private weiToUsdEstimate(priceWei: bigint): string {
    // For testnet: assume 1 ETH ≈ $2000, prices in Wei
    const ethPrice = 2000;
    const ethValue = Number(priceWei) / 1e18;
    const usd = ethValue * ethPrice;
    return `$${usd.toFixed(4)}`;
  }
}
