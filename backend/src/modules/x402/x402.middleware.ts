import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { getAddress } from 'viem';
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

    if (this.x402Config.contractSettlementEnabled) {
      const listedSettlementCheck = await this.validateListedStemSettlementRequest(req, stemId);
      if (!listedSettlementCheck.ok) {
        return res.status(listedSettlementCheck.status).json({
          error: listedSettlementCheck.error,
          message: listedSettlementCheck.message,
        });
      }
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

    const existingSettlement = await this.findExistingSettlement(paymentHeader);
    if (existingSettlement) {
      if (existingSettlement.stemId !== stemId) {
        return res.status(409).json({
          error: 'Payment already redeemed',
          message: 'This x402 payment proof has already been redeemed for a different stem.',
        });
      }
      this.logger.log(`x402 payment replay accepted for stem ${stemId}`);
      return next();
    }

    // Payment header present — verify with facilitator
    try {
      const challenge = await this.paymentService.buildPaymentChallenge(
        this.httpStemResource(stemId, stem.mimeType),
      );
      const result = await this.paymentService.verifyAndSettle(
        paymentHeader,
        challenge.paymentRequirements,
      );
      if (!result.ok) {
        this.logger.warn(`Invalid x402 payment for stem ${stemId}: ${result.reason}`);
        return res.status(402).json({
          error: 'Payment verification failed',
          message: result.reason,
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
      contractSettlement: this.x402Config.contractSettlementEnabled,
      resourceUrl: `/api/stems/${stemId}/x402`,
      description: `Purchase stem ${stemId} via x402`,
      mimeType,
    };
  }

  private findExistingSettlement(paymentHeader: string) {
    return prisma.x402Settlement.findUnique({
      where: {
        paymentProofSha256: createHash('sha256')
          .update(paymentHeader)
          .digest('hex'),
      },
      select: { id: true, stemId: true },
    });
  }

  private async validateListedStemSettlementRequest(req: Request, stemId: string) {
    const listing = await prisma.stemListing.findFirst({
      where: {
        stemId,
        status: 'active',
        amount: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      select: {
        paymentToken: true,
      },
      orderBy: { listedAt: 'desc' },
    });
    if (!listing) {
      return { ok: true as const };
    }

    const buyer = this.resolveBuyerAddress(req);
    if (!buyer) {
      return {
        ok: false as const,
        status: 400,
        error: 'Buyer wallet required',
        message:
          'Listed x402 purchases require a buyer wallet address via X-Resonate-Buyer or ?buyer= before payment.',
      };
    }

    const asset = this.paymentService.resolveAssetInfo();
    if (listing.paymentToken.toLowerCase() !== asset.address.toLowerCase()) {
      return {
        ok: false as const,
        status: 409,
        error: 'Unsupported listing payment asset',
        message:
          'The active marketplace listing is not priced in the configured x402 stablecoin asset.',
      };
    }

    return { ok: true as const };
  }

  private resolveBuyerAddress(req: Request) {
    const header =
      (req.headers['x-resonate-buyer'] as string | undefined) ??
      (req.headers['x-buyer-address'] as string | undefined);
    const queryBuyer = req.query?.buyer ?? req.query?.recipient;
    const raw = header || (Array.isArray(queryBuyer) ? queryBuyer[0] : queryBuyer);
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      return getAddress(raw.trim());
    } catch {
      return null;
    }
  }
}
