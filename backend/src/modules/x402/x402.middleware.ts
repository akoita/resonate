import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { X402Config } from './x402.config';
import { prisma } from '../../db/prisma';
import { formatUsdcAmount } from './x402.quote';
import { getDefaultX402Asset } from './x402.public';

// `@x402/core/http` only publishes ESM typings, while this backend still
// compiles under CommonJS-style resolution. Pull the decoder from the CJS build
// directly so local compilation and Jest stay happy.
const {
  decodePaymentSignatureHeader,
}: { decodePaymentSignatureHeader: (header: string) => unknown } = require(path.join(
  process.cwd(),
  'node_modules/@x402/core/dist/cjs/http/index.js',
));

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

    const stem = await this.findProtectedStem(stemId);
    if (!stem) {
      return res.status(404).json({ error: 'Stem not found' });
    }

    if (!stem.uri) {
      return res.status(404).json({ error: 'Stem file not available' });
    }

    // Skip the /info sub-route — it's free
    if (req.path.endsWith('/x402/info')) {
      return next();
    }

    // AgentCash/x402 v2 retries with PAYMENT-SIGNATURE, while older flows may
    // still use X-PAYMENT. Accept both so the protected route works with the
    // current client stack.
    const paymentHeader =
      (req.headers['payment-signature'] as string | undefined) ??
      (req.headers['x-payment'] as string | undefined);

    if (!paymentHeader) {
      // No payment — return 402 with payment instructions
      return this.send402(res, stemId, stem.mimeType);
    }

    // Payment header present — verify with facilitator
    try {
      const paymentContext = await this.buildPaymentContext(
        stemId,
        paymentHeader,
        stem.mimeType,
      );
      const isValid = await this.verifyPayment(
        paymentContext.paymentPayload,
        paymentContext.paymentRequirements,
      );
      if (!isValid) {
        this.logger.warn(`Invalid x402 payment for stem ${stemId}`);
        return res.status(402).json({
          error: 'Payment verification failed',
          message: 'The payment proof could not be verified by the facilitator.',
        });
      }

      // Payment verified — settle it
      await this.settlePayment(
        paymentContext.paymentPayload,
        paymentContext.paymentRequirements,
      );
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
  private async send402(res: Response, stemId: string, mimeType?: string | null) {
    const paymentRequired = await this.buildPaymentRequired(stemId, mimeType);

    // AgentCash's HTTP client expects the V2 challenge in the PAYMENT-REQUIRED header.
    const encodedPaymentRequired = Buffer.from(
      JSON.stringify(paymentRequired),
      'utf8',
    ).toString('base64');

    res.setHeader('PAYMENT-REQUIRED', encodedPaymentRequired);
    res.status(402).json(paymentRequired);
  }

  private async buildPaymentRequired(stemId: string, mimeType?: string | null) {
    const pricing = await prisma.stemPricing.findUnique({
      where: { stemId },
    });

    // Keep the 402 challenge aligned with the machine-readable storefront quote.
    const amountUsd = pricing?.basePlayPriceUsd ?? 0.05;
    const priceUsd = `$${formatUsdcAmount(amountUsd)}`;
    const assetInfo = getDefaultX402Asset(this.x402Config.network);

    return {
      x402Version: 2,
      error: 'Payment required',
      resource: {
        url: `/api/stems/${stemId}/x402`,
        description: `Purchase stem ${stemId} via x402`,
        mimeType: mimeType || 'audio/mpeg',
      },
      accepts: [
        {
          scheme: 'exact',
          network: this.x402Config.network,
          amount: this.toTokenAmount(amountUsd, assetInfo.decimals),
          asset: assetInfo.address,
          payTo: this.x402Config.payoutAddress,
          maxTimeoutSeconds: 300,
          extra: {
            name: assetInfo.name,
            version: assetInfo.version,
            displayPrice: priceUsd,
          },
        },
      ],
    };
  }

  private async buildPaymentContext(
    stemId: string,
    paymentHeader: string,
    mimeType?: string | null,
  ) {
    const paymentRequired = await this.buildPaymentRequired(stemId, mimeType);
    return {
      paymentPayload: decodePaymentSignatureHeader(paymentHeader),
      paymentRequirements: paymentRequired.accepts[0],
    };
  }

  private toTokenAmount(amount: number, decimals: number): string {
    const [intPart, decPart = ''] = String(amount).split('.');
    const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals);
    return (intPart + paddedDec).replace(/^0+/, '') || '0';
  }

  private async findProtectedStem(stemId: string) {
    return prisma.stem.findUnique({
      where: { id: stemId },
      select: {
        id: true,
        uri: true,
        mimeType: true,
      },
    });
  }

  /**
   * Verify payment proof with the x402 facilitator.
   */
  private async verifyPayment(
    paymentPayload: unknown,
    paymentRequirements: unknown,
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.x402Config.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        this.logger.warn(
          `Facilitator /verify returned ${response.status}${
            errorBody ? `: ${errorBody}` : ''
          }`,
        );
        return false;
      }

      const result = await response.json();
      return result.isValid === true;
    } catch (error) {
      this.logger.error(`Facilitator /verify failed: ${error}`);
      return false;
    }
  }

  /**
   * Settle payment with the x402 facilitator.
   */
  private async settlePayment(
    paymentPayload: unknown,
    paymentRequirements: unknown,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.x402Config.facilitatorUrl}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 2,
          paymentPayload,
          paymentRequirements,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        this.logger.warn(
          `Facilitator /settle returned ${response.status}${
            errorBody ? `: ${errorBody}` : ''
          }`,
        );
      }
    } catch (error) {
      // Settlement failure is logged but doesn't block delivery
      // The facilitator handles eventual settlement
      this.logger.error(`Facilitator /settle failed: ${error}`);
    }
  }
}
