import { Controller, Get, Param, Res, Logger, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { X402Config } from './x402.config';
import { prisma } from '../../db/prisma';
import { EncryptionService } from '../encryption/encryption.service';
import { buildStemX402Quote } from './x402.quote';

/**
 * X402Controller — Public stem download endpoint gated by x402 USDC payment.
 *
 * Flow:
 *   1. Agent sends GET /api/stems/:stemId/x402
 *   2. x402 middleware intercepts → returns 402 with USDC payment instructions
 *   3. Agent pays USDC on Base Sepolia
 *   4. Agent retries with X-PAYMENT header
 *   5. Facilitator verifies & settles → middleware passes request through
 *   6. Controller serves the decrypted stem audio
 *   7. Purchase recorded in StemPurchase table
 *
 * No JWT required — agents are unauthenticated.
 */
@Controller('api/stems')
export class X402Controller {
  private readonly logger = new Logger(X402Controller.name);

  constructor(
    private readonly x402Config: X402Config,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * GET /api/stems/:stemId/x402
   *
   * Protected by x402 paymentMiddleware (configured in X402Module).
   * When this handler runs, payment has already been verified and settled.
   */
  @Get(':stemId/x402')
  async downloadWithPayment(
    @Param('stemId') stemId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.x402Config.enabled) {
      res.status(HttpStatus.NOT_FOUND).json({
        error: 'x402 payments are not enabled on this server',
      });
      return;
    }

    try {
      // 1. Look up the stem
      const stem = await prisma.stem.findUnique({
        where: { id: stemId },
        include: {
          track: {
            include: {
              release: { select: { id: true, title: true, primaryArtist: true } },
            },
          },
          nftMint: { select: { tokenId: true } },
        },
      });

      if (!stem) {
        res.status(HttpStatus.NOT_FOUND).json({ error: 'Stem not found' });
        return;
      }

      if (!stem.uri) {
        res
          .status(HttpStatus.NOT_FOUND)
          .json({ error: 'Stem file not available' });
        return;
      }

      this.logger.log(
        `x402 payment verified — serving stem ${stemId} (${stem.type})`,
      );

      // 2. Fetch/decrypt the audio content
      let audioBuffer: Buffer;

      if (stem.encryptionMetadata) {
        // Decrypt using the encryption service with a server-side auth sig
        const serverAuthSig = {
          address: this.x402Config.payoutAddress.toLowerCase(),
          sig: 'x402-payment-verified',
          signedMessage: 'Download authorized via x402 payment verification',
        };
        audioBuffer = await this.encryptionService.decrypt(
          stem.uri,
          stem.encryptionMetadata,
          [],
          serverAuthSig,
        );
      } else {
        // Unencrypted — fetch directly
        const response = await fetch(stem.uri);
        if (!response.ok) {
          throw new Error(`Failed to fetch stem: ${response.status}`);
        }
        audioBuffer = Buffer.from(await response.arrayBuffer());
      }

      // 3. Log the x402 purchase for provenance
      // StemPurchase requires a FK to StemListing (on-chain marketplace),
      // so we log x402 purchases as ContractEvents instead.
      await prisma.contractEvent.create({
        data: {
          eventName: 'x402.purchase',
          chainId: 84532, // Base Sepolia
          contractAddress: this.x402Config.payoutAddress,
          transactionHash: `x402:${stemId}:${Date.now()}`,
          logIndex: 0,
          blockNumber: BigInt(0),
          blockHash: '',
          args: {
            stemId,
            stemType: stem.type,
            trackTitle: stem.track?.title,
            payTo: this.x402Config.payoutAddress,
            network: this.x402Config.network,
          },
          processedAt: new Date(),
        },
      });

      this.logger.log(`x402 purchase recorded for stem ${stemId}`);

      // 4. Serve the audio
      const filename = `${stem.title || stem.type || 'stem'}.mp3`;
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
      });

      res.send(audioBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`x402 download failed for stem ${stemId}: ${message}`);
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Download failed', message });
    }
  }

  /**
   * GET /api/stems/:stemId/x402/info
   *
   * Public info endpoint — returns stem metadata and pricing without payment.
   * Useful for agents to discover what's available before paying.
   */
  @Get(':stemId/x402/info')
  async getStemInfo(@Param('stemId') stemId: string) {
    if (!this.x402Config.enabled) {
      return { error: 'x402 payments are not enabled on this server' };
    }

    const stem = await prisma.stem.findUnique({
      where: { id: stemId },
      include: {
        track: {
          include: {
            release: {
              select: { id: true, title: true, primaryArtist: true },
            },
          },
        },
        nftMint: { select: { tokenId: true } },
      },
    });

    if (!stem) {
      return { error: 'Stem not found' };
    }

    // Look up active listing price
    const listing = await prisma.stemListing.findFirst({
      where: {
        stemId: stem.id,
        status: 'active',
      },
      orderBy: { listedAt: 'desc' },
    });

    // Also check StemPricing for a base price
    const pricing = await prisma.stemPricing.findUnique({
      where: { stemId: stem.id },
    });

    return buildStemX402Quote({
      stemId: stem.id,
      type: stem.type,
      title: stem.title,
      trackTitle: stem.track?.title ?? null,
      artist: stem.track?.release?.primaryArtist ?? null,
      releaseTitle: stem.track?.release?.title ?? null,
      hasNft: !!stem.nftMint,
      tokenId: stem.nftMint?.tokenId?.toString() ?? null,
      basePlayPriceUsd: pricing?.basePlayPriceUsd,
      remixLicenseUsd: pricing?.remixLicenseUsd,
      commercialLicenseUsd: pricing?.commercialLicenseUsd,
      listingWei: listing?.pricePerUnit ?? null,
      network: this.x402Config.network,
      payTo: this.x402Config.payoutAddress,
    });
  }
}
