import { Body, Controller, Get, Inject, Optional, Param, Post, Req, Res, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import path from 'node:path';
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Address,
  type TransactionReceipt,
} from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import { X402Config } from './x402.config';
import { prisma } from '../../db/prisma';
import { EncryptionService } from '../encryption/encryption.service';
import { buildStemX402Quote } from './x402.quote';
import { buildStemX402Receipt, encodeX402ReceiptHeader } from './x402.receipt';
import { getX402ChainId, resolveX402AssetInfo, type X402AssetInfo } from './x402.public';
import { buildStorefrontStemDetail } from '../storefront/storefront.presenter';
import { PaymentsService } from '../payments/payments.service';
import { StorageProvider } from '../storage/storage_provider';

type SmartAccountPaymentBody = {
  txHash?: string;
  payer?: string;
};

type VerifiedSmartAccountPayment = {
  txHash: `0x${string}`;
  payer: Address;
  assetAddress: Address;
  amountUnits: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
};

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const ERC20_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
} as const;

/**
 * X402Controller — Public stem download endpoint gated by x402 USDC payment.
 *
 * Flow:
 *   1. Agent sends GET /api/stems/:stemId/x402
 *   2. x402 middleware intercepts → returns 402 with USDC payment instructions
 *   3. Agent pays USDC on the configured x402 network
 *   4. Agent retries with PAYMENT-SIGNATURE (or legacy X-PAYMENT)
 *   5. Facilitator verifies & settles → middleware passes request through
 *   6. Controller serves the decrypted stem audio
 *   7. Purchase provenance is recorded as a ContractEvent
 *
 * No JWT required — agents are unauthenticated.
 */
@Controller('api/stems')
export class X402Controller {
  private readonly logger = new Logger(X402Controller.name);

  constructor(
    private readonly x402Config: X402Config,
    private readonly encryptionService: EncryptionService,
    @Optional()
    private readonly paymentsService?: PaymentsService,
    @Optional()
    @Inject(StorageProvider)
    private readonly storageProvider?: StorageProvider,
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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.x402Config.enabled) {
      res.status(HttpStatus.NOT_FOUND).json({
        error: 'x402 payments are not enabled on this server',
      });
      return;
    }

    const purchasedAt = new Date();
    const paymentHeaderValue =
      req.headers['payment-signature'] ?? req.headers['x-payment'];
    const paymentHeader = Array.isArray(paymentHeaderValue)
      ? paymentHeaderValue[0]
      : paymentHeaderValue;

    return this.servePaidStemDownload({
      stemId,
      req,
      res,
      purchasedAt,
      eventTransactionHash: `x402:${stemId}:${purchasedAt.getTime()}`,
      paymentProof: paymentHeader,
      contractAddress: this.x402Config.payoutAddress,
      logIndex: 0,
      blockNumber: BigInt(0),
      blockHash: '',
    });
  }

  /**
   * POST /api/stems/:stemId/x402/smart-account
   *
   * Human checkout path for Resonate passkey wallets. The frontend sends a
   * Kernel UserOperation that transfers USDC from the user's smart account to
   * the configured x402 payout address. This endpoint verifies the resulting
   * chain transaction before serving the same receipt + stem artifact as the
   * facilitator-backed x402 route.
   */
  @Post(':stemId/x402/smart-account')
  async downloadWithSmartAccountPayment(
    @Param('stemId') stemId: string,
    @Body() body: SmartAccountPaymentBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.x402Config.enabled) {
      res.status(HttpStatus.NOT_FOUND).json({
        error: 'x402 payments are not enabled on this server',
      });
      return;
    }

    try {
      const verified = await this.verifySmartAccountPayment(stemId, body);
      return this.servePaidStemDownload({
        stemId,
        req,
        res,
        purchasedAt: new Date(),
        eventTransactionHash: verified.txHash,
        paymentProof: `smart-account:${verified.payer}:${verified.txHash}`,
        contractAddress: verified.assetAddress,
        logIndex: verified.logIndex,
        blockNumber: verified.blockNumber,
        blockHash: verified.blockHash,
        payer: verified.payer,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`x402 smart-account verification failed for stem ${stemId}: ${message}`);
      res.status(HttpStatus.PAYMENT_REQUIRED).json({
        error: 'Smart-account payment verification failed',
        message,
      });
    }
  }

  private async servePaidStemDownload(input: {
    stemId: string;
    req: Request;
    res: Response;
    purchasedAt: Date;
    eventTransactionHash: string;
    paymentProof?: string | null;
    contractAddress: string;
    logIndex: number;
    blockNumber: bigint;
    blockHash: string;
    payer?: string;
  }) {
    try {
      const { stemId, req, res } = input;
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

      const pricing = await prisma.stemPricing.findUnique({
        where: { stemId: stem.id },
      });
      const amountUsd = pricing?.basePlayPriceUsd ?? 0.05;
      const assetInfo = this.resolveAssetInfo();
      const resolvedStemUrl = this.resolveStemUrl(stem.uri, req);
      const responseMimeType = stem.mimeType || 'audio/mpeg';

      // 2. Fetch/decrypt the audio content
      let audioBuffer: Buffer;

      if (stem.encryptionMetadata) {
        const encryptedBuffer = await this.fetchPaidStemSourceBuffer({
          uri: stem.uri,
          resolvedUri: resolvedStemUrl,
          data: stem.data,
          errorLabel: 'encrypted data',
        });
        // Decrypt using the encryption service with a server-side auth sig
        const serverAuthSig = {
          address: this.x402Config.payoutAddress.toLowerCase(),
          sig: 'x402-payment-verified',
          signedMessage: 'Download authorized via x402 payment verification',
          internalKey: process.env.INTERNAL_SERVICE_KEY,
        };
        audioBuffer = await this.encryptionService.decryptBuffer(
          encryptedBuffer,
          stem.encryptionMetadata,
          serverAuthSig,
          stem.uri,
        );
      } else {
        audioBuffer = await this.fetchPaidStemSourceBuffer({
          uri: stem.uri,
          resolvedUri: resolvedStemUrl,
          data: stem.data,
          errorLabel: 'stem',
        });
      }

      // 3. Log the x402 purchase for provenance
      // StemPurchase requires a FK to StemListing (on-chain marketplace),
      // so we log x402 purchases as ContractEvents instead.
      const receipt = buildStemX402Receipt({
        stemId: stem.id,
        stemType: stem.type,
        stemTitle: stem.title ?? null,
        trackTitle: stem.track?.title ?? null,
        artist: stem.track?.release?.primaryArtist ?? null,
        releaseTitle: stem.track?.release?.title ?? null,
        hasNft: !!stem.nftMint,
        tokenId: stem.nftMint?.tokenId?.toString() ?? null,
        amountUsd,
        paymentAsset: {
          assetId: assetInfo.assetId,
          tokenAddress: assetInfo.address,
          symbol: assetInfo.symbol,
          decimals: assetInfo.decimals,
          amountUnits: this.toTokenAmount(amountUsd, assetInfo.decimals),
        },
        network: this.x402Config.network,
        payTo: this.x402Config.payoutAddress,
        resource: `/api/stems/${stem.id}/x402`,
        quoteUrl: `/api/stems/${stem.id}/x402/info`,
        mimeType: responseMimeType,
        contentLength: audioBuffer.length,
        eventTransactionHash: input.eventTransactionHash,
        paymentHeader: input.paymentProof,
        purchasedAt: input.purchasedAt,
      });

      await prisma.contractEvent.create({
        data: {
          eventName: 'x402.purchase',
          chainId: getX402ChainId(this.x402Config.network),
          contractAddress: input.contractAddress,
          transactionHash: input.eventTransactionHash,
          logIndex: input.logIndex,
          blockNumber: input.blockNumber,
          blockHash: input.blockHash,
          args: {
            stemId,
            stemType: stem.type,
            trackTitle: stem.track?.title,
            payTo: this.x402Config.payoutAddress,
            payer: input.payer,
            network: this.x402Config.network,
            receiptId: receipt.receiptId,
            licenseKey: receipt.license.key,
            amount: receipt.payment.amount,
            amountUsd: receipt.payment.amountUsd,
            canonicalAmountUsd: receipt.payment.canonicalAmountUsd,
            settlementAmount: receipt.payment.settlementAmount,
            settlementAmountUnits: receipt.payment.settlementAmountUnits,
            currency: receipt.payment.currency,
            paymentToken: receipt.payment.asset.tokenAddress,
            paymentAssetId: receipt.payment.asset.assetId,
            paymentAssetSymbol: receipt.payment.asset.symbol,
            paymentAssetDecimals: receipt.payment.asset.decimals,
            paymentProofSha256: receipt.payment.paymentProofSha256,
          },
          processedAt: input.purchasedAt,
        },
      });

      this.logger.log(`x402 purchase recorded for stem ${stemId}`);

      // 4. Serve the audio
      const filename = `${stem.title || stem.type || 'stem'}${this.getDownloadExtension(stem.uri, responseMimeType)}`;
      const encodedReceipt = encodeX402ReceiptHeader(receipt);
      res.set({
        'Content-Type': responseMimeType,
        'Content-Length': String(audioBuffer.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Expose-Headers':
          'X-Resonate-Receipt,X-Resonate-Receipt-Id,X-Resonate-Receipt-Content-Type,X-Resonate-License,X-Payment-Response',
        'X-Resonate-License': receipt.license.key,
        'X-Resonate-Receipt': encodedReceipt,
        'X-Resonate-Receipt-Content-Type':
          'application/vnd.resonate.purchase-receipt+json',
        'X-Resonate-Receipt-Id': receipt.receiptId,
      });

      res.send(audioBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`x402 download failed for stem ${input.stemId}: ${message}`);
      input.res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Download failed', message });
    }
  }

  private async verifySmartAccountPayment(
    stemId: string,
    body: SmartAccountPaymentBody,
  ): Promise<VerifiedSmartAccountPayment> {
    if (!body.txHash || !TX_HASH_PATTERN.test(body.txHash)) {
      throw new Error('A valid payment transaction hash is required.');
    }
    if (!body.payer) {
      throw new Error('A paying smart-account address is required.');
    }

    const payer = getAddress(body.payer);
    const txHash = body.txHash as `0x${string}`;
    const existing = await prisma.contractEvent.findFirst({
      where: {
        eventName: 'x402.purchase',
        transactionHash: txHash,
      },
      select: { id: true },
    });
    if (existing) {
      throw new Error('This payment transaction has already been redeemed.');
    }

    const pricing = await prisma.stemPricing.findUnique({
      where: { stemId },
    });
    const amountUsd = pricing?.basePlayPriceUsd ?? 0.05;
    const asset = this.resolveAssetInfo();
    const amountUnits = this.toTokenAmount(amountUsd, asset.decimals);
    const payTo = getAddress(this.x402Config.payoutAddress);
    const assetAddress = getAddress(asset.address);

    const receipt = await this.getX402PublicClient().waitForTransactionReceipt({
      hash: txHash,
      timeout: 60_000,
    });
    if (receipt.status !== 'success') {
      throw new Error('The smart-account payment transaction reverted.');
    }

    const transfer = this.findVerifiedTransfer(receipt, {
      assetAddress,
      payer,
      payTo,
      minAmountUnits: BigInt(amountUnits),
    });
    if (!transfer) {
      throw new Error('No matching USDC transfer to the x402 payout address was found.');
    }

    return {
      txHash,
      payer,
      assetAddress,
      amountUnits,
      logIndex: transfer.logIndex,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  private findVerifiedTransfer(
    receipt: TransactionReceipt,
    input: {
      assetAddress: Address;
      payer: Address;
      payTo: Address;
      minAmountUnits: bigint;
    },
  ) {
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== input.assetAddress) continue;
      try {
        const decoded = decodeEventLog({
          abi: [ERC20_TRANSFER_EVENT],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== 'Transfer') continue;
        const args = decoded.args as {
          from: Address;
          to: Address;
          value: bigint;
        };
        if (
          getAddress(args.from) === input.payer &&
          getAddress(args.to) === input.payTo &&
          args.value >= input.minAmountUnits
        ) {
          return { logIndex: log.logIndex };
        }
      } catch {
        // Ignore unrelated logs emitted by the token contract.
      }
    }
    return null;
  }

  private getX402PublicClient() {
    const rpcUrl = this.x402Config.rpcUrl;
    if (!rpcUrl) {
      throw new Error(
        `X402_RPC_URL is required for smart-account x402 verification on chain ${this.x402Config.chainId}`,
      );
    }
    return createPublicClient({
      chain: this.getX402ViemChain(rpcUrl),
      transport: http(rpcUrl),
    });
  }

  private resolveAssetInfo(): X402AssetInfo {
    return resolveX402AssetInfo(
      this.x402Config.network,
      this.paymentsService?.getPaymentAssets(this.x402Config.chainId).assets,
    );
  }

  private getX402ViemChain(rpcUrl: string) {
    if (this.x402Config.chainId === baseSepolia.id) {
      return {
        ...baseSepolia,
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      };
    }
    if (this.x402Config.chainId === base.id) {
      return {
        ...base,
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      };
    }
    if (this.x402Config.chainId === foundry.id) {
      return {
        ...foundry,
        rpcUrls: {
          default: { http: [rpcUrl] },
          public: { http: [rpcUrl] },
        },
      };
    }
    return {
      id: this.x402Config.chainId,
      name: `x402 chain ${this.x402Config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    };
  }

  private toTokenAmount(amount: number, decimals: number): string {
    const [intPart, decPart = ''] = String(amount).split('.');
    const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals);
    return (intPart + paddedDec).replace(/^0+/, '') || '0';
  }

  private resolveStemUrl(uri: string, req: Request) {
    if (/^https?:\/\//i.test(uri)) {
      return uri;
    }

    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto || req.protocol || 'http';
    const host = req.get('host') || process.env.BACKEND_HOST || 'localhost:3000';

    return new URL(uri, `${protocol}://${host}`).toString();
  }

  private async fetchPaidStemSourceBuffer(input: {
    uri: string;
    resolvedUri: string;
    data?: Buffer | Uint8Array | null;
    errorLabel: string;
  }): Promise<Buffer> {
    if (input.data && input.data.length > 0) {
      return Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data);
    }

    if (this.storageProvider) {
      for (const candidate of [input.uri, input.resolvedUri]) {
        try {
          const downloaded = await this.storageProvider.download(candidate);
          if (downloaded) {
            this.logger.log(`x402 loaded paid stem source via storage provider: ${candidate}`);
            return downloaded;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`x402 storage download failed for ${candidate}: ${message}`);
        }
      }
    }

    const response = await fetch(input.resolvedUri);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${input.errorLabel}: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private getDownloadExtension(uri: string, mimeType: string) {
    const pathname = /^https?:\/\//i.test(uri) ? new URL(uri).pathname : uri;
    const existingExtension = path.extname(pathname);
    if (existingExtension) {
      return existingExtension;
    }

    if (mimeType === 'audio/mp4') {
      return '.m4a';
    }

    if (mimeType === 'audio/mpeg') {
      return '.mp3';
    }

    return '';
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
            stems: {
              select: { id: true, type: true },
              orderBy: { type: 'asc' },
            },
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

    const quote = buildStemX402Quote({
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

    const storefrontDetail = buildStorefrontStemDetail(
      {
        id: stem.id,
        type: stem.type,
        title: stem.title,
        ipnftId: stem.ipnftId ?? null,
        mimeType: stem.mimeType ?? null,
        durationSeconds: stem.durationSeconds ?? null,
        pricing: pricing
          ? {
              basePlayPriceUsd: pricing.basePlayPriceUsd,
              remixLicenseUsd: pricing.remixLicenseUsd,
              commercialLicenseUsd: pricing.commercialLicenseUsd,
            }
          : null,
        listingWei: listing?.pricePerUnit ?? null,
        track: {
          id: stem.track.id,
          title: stem.track.title,
          artist: stem.track.artist ?? null,
          stems: stem.track.stems,
          release: {
            id: stem.track.release.id,
            title: stem.track.release.title,
            primaryArtist: stem.track.release.primaryArtist ?? null,
          },
        },
      },
      this.x402Config,
    );

    return {
      ...storefrontDetail,
      stemId: quote.stemId,
      type: quote.type,
      hasNft: quote.hasNft,
      tokenId: quote.tokenId,
      purchase: quote.purchase,
      x402: quote.x402,
    };
  }
}
