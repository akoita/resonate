import { Body, Controller, Get, Inject, Optional, Param, Post, Req, Res, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  createWalletClient,
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  http,
  type Address,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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

type ActiveX402Listing = {
  id: string;
  listingId: bigint;
  tokenId: bigint;
  chainId: number;
  contractAddress: string;
  pricePerUnit: string;
  paymentToken: string;
};

type X402SettlementReceipt = ReturnType<typeof buildStemX402Receipt>;
type X402SettlementStatus = X402SettlementReceipt['settlement']['status'];

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
const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const MARKETPLACE_BUY_FOR_ABI = [
  {
    type: 'function',
    name: 'buyFor',
    stateMutability: 'payable',
    inputs: [
      { name: 'listingId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
] as const;
const MARKETPLACE_SOLD_EVENT = {
  type: 'event',
  name: 'Sold',
  inputs: [
    { indexed: true, name: 'listingId', type: 'uint256' },
    { indexed: true, name: 'buyer', type: 'address' },
    { indexed: false, name: 'amount', type: 'uint256' },
    { indexed: false, name: 'totalPaid', type: 'uint256' },
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
      const assetInfo = this.resolveAssetInfo();
      const paymentProofSha256 = this.hashPaymentProof(input.paymentProof);
      const existingSettlement = await this.findExistingSettlement({
        paymentProofSha256,
        paymentTransactionHash: TX_HASH_PATTERN.test(input.eventTransactionHash)
          ? input.eventTransactionHash
          : null,
      });
      if (existingSettlement) {
        if (existingSettlement.stemId !== stem.id) {
          res.status(HttpStatus.CONFLICT).json({
            error: 'Payment already redeemed',
            message: 'This x402 payment proof has already been redeemed for a different stem.',
          });
          return;
        }
        const receipt = existingSettlement.receipt as X402SettlementReceipt;
        if (existingSettlement.status !== 'download_granted') {
          res.status(HttpStatus.BAD_GATEWAY).json({
            error: 'Contract settlement not complete',
            message:
              existingSettlement.contractSettlementReason ||
              'This x402 payment has not produced a downloadable settlement.',
            receiptId: existingSettlement.receiptId,
            settlement: receipt.settlement,
          });
          return;
        }
        const audioBuffer = await this.loadPaidStemAudio({
          stem,
          req,
          responseMimeType: stem.mimeType || 'audio/mpeg',
        });
        this.writePaidStemResponse({
          res,
          stem,
          audioBuffer,
          responseMimeType: stem.mimeType || 'audio/mpeg',
          receipt,
        });
        return;
      }

      const activeListing = await this.findActiveListing(stem.id);
      const amountUsd = this.resolveReceiptAmountUsd({
        pricing,
        activeListing,
        assetInfo,
      });
      const buyerAddress = this.resolveBuyerAddress(req, input.payer);
      const contractSettlement = await this.resolveContractSettlement({
        listing: activeListing,
        buyerAddress,
        assetInfo,
      });
      const resolvedStemUrl = this.resolveStemUrl(stem.uri, req);
      const responseMimeType = stem.mimeType || 'audio/mpeg';

      if (
        contractSettlement.status === 'contract_failed' ||
        contractSettlement.status === 'contract_required_missing'
      ) {
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
          contentLength: 0,
          eventTransactionHash: input.eventTransactionHash,
          paymentHeader: input.paymentProof,
          purchasedAt: input.purchasedAt,
          settlement: contractSettlement,
        });
        await prisma.x402Settlement.create({
          data: {
            stemId: stem.id,
            listingId: activeListing?.id ?? null,
            listingChainId: activeListing?.chainId ?? null,
            listingContractAddress: activeListing?.contractAddress ?? null,
            listingTokenId: activeListing?.tokenId ?? null,
            payerAddress: buyerAddress?.toLowerCase() ?? input.payer?.toLowerCase() ?? null,
            paymentRail: TX_HASH_PATTERN.test(input.eventTransactionHash)
              ? 'smart_account'
              : 'facilitator',
            paymentProofSha256,
            paymentTransactionHash: TX_HASH_PATTERN.test(input.eventTransactionHash)
              ? input.eventTransactionHash
              : null,
            receiptId: receipt.receiptId,
            receipt,
            status: 'contract_settlement_failed',
            contractSettlementStatus: receipt.settlement.status,
            contractSettlementTxHash: receipt.settlement.transactionHash,
            contractSettlementEventName: receipt.settlement.eventName,
            contractSettlementReason: receipt.settlement.reason,
            paymentToken: receipt.payment.asset.tokenAddress,
            paymentAssetId: receipt.payment.asset.assetId,
            paymentAssetSymbol: receipt.payment.asset.symbol,
            paymentAssetDecimals: receipt.payment.asset.decimals,
            settlementAmount: receipt.payment.settlementAmount,
            settlementAmountUnits: receipt.payment.settlementAmountUnits,
            canonicalAmountUsd: receipt.payment.canonicalAmountUsd,
            purchasedAt: input.purchasedAt,
          },
        });
        res.status(
          contractSettlement.status === 'contract_required_missing'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_GATEWAY,
        ).json({
          error: contractSettlement.status === 'contract_required_missing'
            ? 'Marketplace contract settlement required'
            : 'Contract settlement failed',
          message: contractSettlement.reason,
          receiptId: receipt.receiptId,
          settlement: receipt.settlement,
        });
        return;
      }

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
        settlement: contractSettlement,
      });

      await prisma.$transaction([
        prisma.x402Settlement.create({
          data: {
            stemId: stem.id,
            listingId: activeListing?.id ?? null,
            listingChainId: activeListing?.chainId ?? null,
            listingContractAddress: activeListing?.contractAddress ?? null,
            listingTokenId: activeListing?.tokenId ?? null,
            payerAddress: buyerAddress?.toLowerCase() ?? input.payer?.toLowerCase() ?? null,
            paymentRail: TX_HASH_PATTERN.test(input.eventTransactionHash)
              ? 'smart_account'
              : 'facilitator',
            paymentProofSha256,
            paymentTransactionHash: TX_HASH_PATTERN.test(input.eventTransactionHash)
              ? input.eventTransactionHash
              : null,
            receiptId: receipt.receiptId,
            receipt,
            status: 'download_granted',
            contractSettlementStatus: receipt.settlement.status,
            contractSettlementTxHash: receipt.settlement.transactionHash,
            contractSettlementEventName: receipt.settlement.eventName,
            contractSettlementReason: receipt.settlement.reason,
            paymentToken: receipt.payment.asset.tokenAddress,
            paymentAssetId: receipt.payment.asset.assetId,
            paymentAssetSymbol: receipt.payment.asset.symbol,
            paymentAssetDecimals: receipt.payment.asset.decimals,
            settlementAmount: receipt.payment.settlementAmount,
            settlementAmountUnits: receipt.payment.settlementAmountUnits,
            canonicalAmountUsd: receipt.payment.canonicalAmountUsd,
            purchasedAt: input.purchasedAt,
          },
        }),
        prisma.contractEvent.create({
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
              settlementStatus: receipt.settlement.status,
              settlementEntitlement: receipt.settlement.entitlement,
              settlementListingId: receipt.settlement.listingId,
              settlementTxHash: receipt.settlement.transactionHash,
            },
            processedAt: input.purchasedAt,
          },
        }),
      ]);

      this.logger.log(`x402 purchase recorded for stem ${stemId}`);

      // 4. Serve the audio
      this.writePaidStemResponse({
        res,
        stem,
        audioBuffer,
        responseMimeType,
        receipt,
      });
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
    const existing = await prisma.x402Settlement.findFirst({
      where: {
        paymentTransactionHash: txHash,
      },
      select: { id: true, stemId: true },
    });
    if (existing && existing.stemId !== stemId) {
      throw new Error('This payment transaction has already been redeemed for a different stem.');
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

  private async loadPaidStemAudio(input: {
    stem: {
      uri: string;
      data?: Buffer | Uint8Array | null;
      encryptionMetadata?: string | null;
    };
    req: Request;
    responseMimeType: string;
  }) {
    const resolvedStemUrl = this.resolveStemUrl(input.stem.uri, input.req);
    if (input.stem.encryptionMetadata) {
      const encryptedBuffer = await this.fetchPaidStemSourceBuffer({
        uri: input.stem.uri,
        resolvedUri: resolvedStemUrl,
        data: input.stem.data,
        errorLabel: 'encrypted data',
      });
      const serverAuthSig = {
        address: this.x402Config.payoutAddress.toLowerCase(),
        sig: 'x402-payment-verified',
        signedMessage: 'Download authorized via x402 payment verification',
        internalKey: process.env.INTERNAL_SERVICE_KEY,
      };
      return this.encryptionService.decryptBuffer(
        encryptedBuffer,
        input.stem.encryptionMetadata,
        serverAuthSig,
        input.stem.uri,
      );
    }

    return this.fetchPaidStemSourceBuffer({
      uri: input.stem.uri,
      resolvedUri: resolvedStemUrl,
      data: input.stem.data,
      errorLabel: 'stem',
    });
  }

  private writePaidStemResponse(input: {
    res: Response;
    stem: { title?: string | null; type?: string | null; uri: string };
    audioBuffer: Buffer;
    responseMimeType: string;
    receipt: X402SettlementReceipt;
  }) {
    const filename = `${input.stem.title || input.stem.type || 'stem'}${this.getDownloadExtension(input.stem.uri, input.responseMimeType)}`;
    const encodedReceipt = encodeX402ReceiptHeader(input.receipt);
    input.res.set({
      'Content-Type': input.responseMimeType,
      'Content-Length': String(input.audioBuffer.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Expose-Headers':
        'X-Resonate-Receipt,X-Resonate-Receipt-Id,X-Resonate-Receipt-Content-Type,X-Resonate-License,X-Resonate-Settlement-Status,X-Payment-Response',
      'X-Resonate-License': input.receipt.license.key,
      'X-Resonate-Receipt': encodedReceipt,
      'X-Resonate-Receipt-Content-Type':
        'application/vnd.resonate.purchase-receipt+json',
      'X-Resonate-Receipt-Id': input.receipt.receiptId,
      'X-Resonate-Settlement-Status': input.receipt.settlement.status,
    });

    input.res.send(input.audioBuffer);
  }

  private async findExistingSettlement(input: {
    paymentProofSha256: string | null;
    paymentTransactionHash: string | null;
  }) {
    const or = [
      input.paymentProofSha256
        ? { paymentProofSha256: input.paymentProofSha256 }
        : null,
      input.paymentTransactionHash
        ? { paymentTransactionHash: input.paymentTransactionHash }
        : null,
    ].filter(Boolean) as Array<
      { paymentProofSha256: string } | { paymentTransactionHash: string }
    >;

    if (or.length === 0) return null;

    return prisma.x402Settlement.findFirst({
      where: { OR: or },
    });
  }

  private findActiveListing(stemId: string): Promise<ActiveX402Listing | null> {
    return prisma.stemListing.findFirst({
      where: {
        stemId,
        status: 'active',
        amount: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        listingId: true,
        tokenId: true,
        chainId: true,
        contractAddress: true,
        pricePerUnit: true,
        paymentToken: true,
      },
      orderBy: { listedAt: 'desc' },
    });
  }

  private resolveReceiptAmountUsd(input: {
    pricing:
      | {
          basePlayPriceUsd?: number | null;
        }
      | null
      | undefined;
    activeListing: ActiveX402Listing | null;
    assetInfo: X402AssetInfo;
  }) {
    if (
      this.x402Config.contractSettlementEnabled &&
      input.activeListing &&
      input.activeListing.paymentToken.toLowerCase() === input.assetInfo.address.toLowerCase()
    ) {
      return Number(formatUnits(BigInt(input.activeListing.pricePerUnit), input.assetInfo.decimals));
    }
    return input.pricing?.basePlayPriceUsd ?? 0.05;
  }

  private resolveBuyerAddress(req: Request, fallback?: string | null) {
    const header =
      (req.headers['x-resonate-buyer'] as string | undefined) ??
      (req.headers['x-buyer-address'] as string | undefined);
    const queryBuyer = req.query?.buyer ?? req.query?.recipient;
    const raw = header || (Array.isArray(queryBuyer) ? queryBuyer[0] : queryBuyer) || fallback;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      return getAddress(raw.trim());
    } catch {
      return null;
    }
  }

  private async resolveContractSettlement(input: {
    listing: ActiveX402Listing | null;
    buyerAddress: Address | null;
    assetInfo: X402AssetInfo;
  }) {
    if (!input.listing) {
      return this.describeContractSettlement(null);
    }

    if (input.listing.paymentToken.toLowerCase() !== input.assetInfo.address.toLowerCase()) {
      if (this.x402Config.contractSettlementEnabled) {
        return this.describeContractSettlement(input.listing, {
          status: 'contract_failed',
          reason:
            'The active marketplace listing is not priced in the configured x402 stablecoin asset.',
        });
      }
      return this.describeContractSettlement(input.listing, {
        reason:
          'An active marketplace listing exists, but it is not priced in the configured x402 stablecoin asset.',
      });
    }

    if (!this.x402Config.contractSettlementEnabled) {
      return this.describeContractSettlement(input.listing, {
        reason:
          'This stem has an active marketplace listing, but x402 marketplace contract settlement is not configured.',
      });
    }

    if (input.listing.chainId !== this.x402Config.chainId) {
      return this.describeContractSettlement(input.listing, {
        status: 'contract_failed',
        reason:
          'The active marketplace listing is on a different chain than the configured x402 network.',
      });
    }

    if (!input.buyerAddress) {
      return this.describeContractSettlement(input.listing, {
        status: 'contract_failed',
        reason:
          'Listed x402 purchases require a buyer wallet address to receive contract ownership.',
      });
    }

    try {
      const settlement = await this.executeMarketplaceSettlement({
        listing: input.listing,
        buyerAddress: input.buyerAddress,
      });
      return this.describeContractSettlement(input.listing, {
        status: 'contract_backed',
        transactionHash: settlement.transactionHash,
        eventName: settlement.eventName,
        reason: 'x402 payment was settled through the Resonate marketplace contract.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`x402 contract settlement failed: ${message}`);
      return this.describeContractSettlement(input.listing, {
        status: 'contract_failed',
        reason: message,
      });
    }
  }

  private async executeMarketplaceSettlement(input: {
    listing: ActiveX402Listing;
    buyerAddress: Address;
  }): Promise<{
    transactionHash: `0x${string}`;
    eventName: 'Sold';
  }> {
    if (!this.x402Config.settlementPrivateKey) {
      throw new Error('X402 settlement wallet is not configured.');
    }

    const account = privateKeyToAccount(this.x402Config.settlementPrivateKey);
    if (getAddress(account.address) !== getAddress(this.x402Config.payoutAddress)) {
      throw new Error('X402 settlement wallet must match X402_PAYOUT_ADDRESS.');
    }

    const publicClient = this.getX402PublicClient();
    const walletClient = createWalletClient({
      account,
      chain: this.getX402ViemChain(this.x402Config.rpcUrl),
      transport: http(this.x402Config.rpcUrl),
    });
    const marketplaceAddress = getAddress(input.listing.contractAddress);
    const paymentToken = getAddress(input.listing.paymentToken);
    const pricePerUnit = BigInt(input.listing.pricePerUnit);

    const approveHash = await walletClient.writeContract({
      address: paymentToken,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [marketplaceAddress, pricePerUnit],
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
      timeout: 60_000,
    });
    if (approveReceipt.status !== 'success') {
      throw new Error('Marketplace payment-token approval reverted.');
    }

    const buyHash = await walletClient.writeContract({
      address: marketplaceAddress,
      abi: MARKETPLACE_BUY_FOR_ABI,
      functionName: 'buyFor',
      args: [input.listing.listingId, BigInt(1), input.buyerAddress],
      value: BigInt(0),
    });
    const buyReceipt = await publicClient.waitForTransactionReceipt({
      hash: buyHash,
      timeout: 60_000,
    });
    if (buyReceipt.status !== 'success') {
      throw new Error('Marketplace buyFor transaction reverted.');
    }

    const soldLog = buyReceipt.logs.find((log) => {
      if (getAddress(log.address) !== marketplaceAddress) return false;
      try {
        const decoded = decodeEventLog({
          abi: [MARKETPLACE_SOLD_EVENT],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== 'Sold') return false;
        const args = decoded.args as {
          listingId: bigint;
          buyer: Address;
        };
        return args.listingId === input.listing.listingId &&
          getAddress(args.buyer) === input.buyerAddress;
      } catch {
        return false;
      }
    });
    if (!soldLog) {
      throw new Error('Marketplace buyFor receipt did not include the expected Sold event.');
    }

    return {
      transactionHash: buyHash,
      eventName: 'Sold',
    };
  }

  private describeContractSettlement(
    listing: ActiveX402Listing | null,
    overrides: {
      status?: X402SettlementStatus;
      transactionHash?: string | null;
      eventName?: string | null;
      reason?: string | null;
    } = {},
  ) {
    if (!listing) {
      return {
        status: 'download_only' as const,
        entitlement: 'download_access' as const,
        transactionHash: overrides.transactionHash ?? null,
        eventName: overrides.eventName ?? null,
        reason: 'No active marketplace listing was linked to this x402 redemption.',
      };
    }

    return {
      status: overrides.status ?? 'contract_required_missing',
      entitlement: 'marketplace_purchase' as const,
      listingId: listing.listingId.toString(),
      listingChainId: listing.chainId,
      listingContractAddress: listing.contractAddress,
      tokenId: listing.tokenId.toString(),
      transactionHash: overrides.transactionHash ?? null,
      eventName: overrides.eventName ?? null,
      reason: overrides.reason ??
        'An active marketplace listing exists, but this x402 rail has not yet executed or verified the marketplace contract purchase.',
    };
  }

  private hashPaymentProof(paymentProof?: string | null) {
    if (!paymentProof) return null;
    return createHash('sha256').update(paymentProof).digest('hex');
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
      marketplaceSettlement: listing
        ? {
            required: true,
            available:
              this.x402Config.contractSettlementEnabled &&
              listing.paymentToken.toLowerCase() === this.x402ConfigAssetAddress().toLowerCase() &&
              listing.chainId === this.x402Config.chainId,
            contractSettlementEnabled: this.x402Config.contractSettlementEnabled,
            listingId: listing.listingId.toString(),
            chainId: listing.chainId,
            paymentToken: listing.paymentToken,
          }
        : {
            required: false,
            available: false,
            contractSettlementEnabled: this.x402Config.contractSettlementEnabled,
          },
    };
  }

  private x402ConfigAssetAddress() {
    return this.resolveAssetInfo().address;
  }
}
