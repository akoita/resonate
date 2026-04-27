import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { X402Config } from './x402.config';
import { prisma } from '../../db/prisma';
import { X402PaymentService } from './x402.payment.service';

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

  constructor(
    private readonly x402Config: X402Config,
    private readonly paymentService: X402PaymentService,
  ) {}

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
      const challenge = await this.paymentService.buildPaymentChallenge(
        this.httpStemResource(stemId, stem.mimeType),
      );
      const isValid = await this.paymentService.verifyAndSettle(
        paymentHeader,
        challenge.paymentRequirements,
      );
      if (!isValid) {
        this.logger.warn(`Invalid x402 payment for stem ${stemId}`);
        return res.status(402).json({
          error: 'Payment verification failed',
          message: 'The payment proof could not be verified by the facilitator.',
        });
      }

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

    // Browsers can only read the V2 challenge header when CORS exposes it.
    res.setHeader(
      'Access-Control-Expose-Headers',
      'PAYMENT-REQUIRED, X-Payment-Response',
    );
    res.setHeader('PAYMENT-REQUIRED', encodedPaymentRequired);
    res.status(402).json(paymentRequired);
  }

  private async buildPaymentRequired(stemId: string, mimeType?: string | null) {
    return this.paymentService.buildPaymentRequired(
      this.httpStemResource(stemId, mimeType),
    );
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

  private httpStemResource(stemId: string, mimeType?: string | null) {
    return {
      stemId,
      licenseType: "personal" as const,
      resourceUrl: `/api/stems/${stemId}/x402`,
      description: `Purchase stem ${stemId} via x402`,
      mimeType,
    };
  }
}
