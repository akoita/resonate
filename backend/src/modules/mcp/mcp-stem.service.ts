import { Injectable } from "@nestjs/common";
import path from "node:path";
import { prisma } from "../../db/prisma";
import { EncryptionService } from "../encryption/encryption.service";
import { X402Config } from "../x402/x402.config";
import {
  X402PaymentChallenge,
  X402PaymentService,
} from "../x402/x402.payment.service";
import {
  buildStemX402Receipt,
  encodeX402ReceiptHeader,
} from "../x402/x402.receipt";
import { formatUsdcAmount, QuoteLicenseKey } from "../x402/x402.quote";
import { getX402ChainId } from "../x402/x402.public";

export type McpStemQuote = {
  stemId: string;
  licenseType: QuoteLicenseKey;
  priceUsdc: string;
  expiresAt: string;
  paymentChallenge: X402PaymentChallenge;
  stem: {
    title: string | null;
    type: string;
    trackTitle: string | null;
    artist: string | null;
    releaseTitle: string | null;
    mimeType: string;
  };
};

export type McpStemDownloadResult =
  | {
      ok: true;
      structuredContent: Record<string, unknown>;
      content: Array<Record<string, unknown>>;
    }
  | {
      ok: false;
      structuredContent: Record<string, unknown>;
      content: Array<Record<string, unknown>>;
    };

type StemRecord = Awaited<ReturnType<McpStemService["findStem"]>>;

@Injectable()
export class McpStemService {
  constructor(
    private readonly x402Config: X402Config,
    private readonly paymentService: X402PaymentService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async quote(stemId: string, licenseType: QuoteLicenseKey): Promise<McpStemQuote> {
    this.assertX402Enabled();
    const stem = await this.requireDownloadableStem(stemId);
    return this.buildQuote(stem, licenseType);
  }

  async download(
    stemId: string,
    licenseType: QuoteLicenseKey,
    paymentProof?: string,
  ): Promise<McpStemDownloadResult> {
    this.assertX402Enabled();
    const stem = await this.requireDownloadableStem(stemId);
    const quote = await this.buildQuote(stem, licenseType);
    if (!paymentProof) {
      return this.paymentRequired(quote, "Missing paymentProof.");
    }

    const verified = await this.paymentService.verifyAndSettle(
      paymentProof,
      quote.paymentChallenge.paymentRequirements,
    );
    if (!verified) {
      return this.paymentRequired(
        quote,
        "The paymentProof could not be verified by the x402 facilitator.",
      );
    }

    const audioBuffer = await this.readStemAudio(stem);
    const purchasedAt = new Date();
    const transactionHash = `x402:mcp:${stem.id}:${purchasedAt.getTime()}`;
    const amountUsd = Number(quote.priceUsdc);
    const receipt = buildStemX402Receipt({
      stemId: stem.id,
      stemType: stem.type,
      stemTitle: stem.title ?? null,
      trackTitle: stem.track?.title ?? null,
      artist: stem.track?.release?.primaryArtist ?? null,
      releaseTitle: stem.track?.release?.title ?? null,
      hasNft: !!stem.nftMint,
      tokenId: stem.nftMint?.tokenId?.toString() ?? null,
      licenseKey: licenseType,
      amountUsd,
      network: this.x402Config.network,
      payTo: this.x402Config.payoutAddress,
      resource: this.mcpDownloadResourceUrl(stem.id, licenseType),
      quoteUrl: this.mcpQuoteResourceUrl(stem.id, licenseType),
      mimeType: this.mimeType(stem),
      contentLength: audioBuffer.length,
      eventTransactionHash: transactionHash,
      paymentHeader: paymentProof,
      purchasedAt,
    });

    await prisma.contractEvent.create({
      data: {
        eventName: "x402.purchase",
        chainId: getX402ChainId(this.x402Config.network),
        contractAddress: this.x402Config.payoutAddress,
        transactionHash,
        logIndex: 0,
        blockNumber: BigInt(0),
        blockHash: "",
        args: {
          source: "mcp",
          tool: "stem.download",
          stemId: stem.id,
          stemType: stem.type,
          trackTitle: stem.track?.title,
          payTo: this.x402Config.payoutAddress,
          network: this.x402Config.network,
          receiptId: receipt.receiptId,
          licenseKey: receipt.license.key,
          amount: receipt.payment.amount,
          currency: receipt.payment.currency,
          paymentProofSha256: receipt.payment.paymentProofSha256,
        },
        processedAt: purchasedAt,
      },
    });

    const filename = `${stem.title || stem.type || "stem"}${this.downloadExtension(
      stem.uri,
      this.mimeType(stem),
    )}`;
    const resourceUri = `resonate://stems/${encodeURIComponent(
      stem.id,
    )}/x402/${receipt.receiptId}`;
    const structuredContent = {
      stemId: stem.id,
      licenseType,
      receiptId: receipt.receiptId,
      receipt: {
        ...receipt,
        encoded: encodeX402ReceiptHeader(receipt),
      },
      resource: {
        uri: resourceUri,
        name: filename,
        mimeType: this.mimeType(stem),
        bytes: audioBuffer.length,
      },
    };

    return {
      ok: true,
      structuredContent,
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
        {
          type: "resource",
          resource: {
            uri: resourceUri,
            mimeType: this.mimeType(stem),
            blob: audioBuffer.toString("base64"),
          },
        },
      ],
    };
  }

  private async buildQuote(
    stem: NonNullable<StemRecord>,
    licenseType: QuoteLicenseKey,
  ): Promise<McpStemQuote> {
    const amountUsd = this.paymentService.resolveLicenseAmountUsd(
      stem.pricing,
      licenseType,
    );
    const paymentChallenge = await this.paymentService.buildPaymentChallenge({
      stemId: stem.id,
      licenseType,
      resourceUrl: this.mcpDownloadResourceUrl(stem.id, licenseType),
      description: `Purchase ${licenseType} license for stem ${stem.id} via MCP`,
      mimeType: this.mimeType(stem),
    });
    const timeoutSeconds = Number(
      paymentChallenge.paymentRequirements.maxTimeoutSeconds ?? 300,
    );

    return {
      stemId: stem.id,
      licenseType,
      priceUsdc: formatUsdcAmount(amountUsd),
      expiresAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
      paymentChallenge,
      stem: {
        title: stem.title ?? null,
        type: stem.type,
        trackTitle: stem.track?.title ?? null,
        artist: stem.track?.release?.primaryArtist ?? null,
        releaseTitle: stem.track?.release?.title ?? null,
        mimeType: this.mimeType(stem),
      },
    };
  }

  private paymentRequired(quote: McpStemQuote, message: string) {
    const structuredContent = {
      code: "PAYMENT_REQUIRED",
      message,
      challenge: quote,
    };
    return {
      ok: false as const,
      structuredContent,
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };
  }

  private async requireDownloadableStem(stemId: string) {
    const stem = await this.findStem(stemId);
    if (!stem) {
      throw new Error(`Stem ${stemId} not found`);
    }
    if (!stem.uri) {
      throw new Error(`Stem ${stemId} has no downloadable file`);
    }
    return stem;
  }

  private assertX402Enabled() {
    if (!this.x402Config.enabled || !this.x402Config.payoutAddress) {
      throw new Error("x402 payments are not enabled on this server");
    }
  }

  private findStem(stemId: string) {
    return prisma.stem.findUnique({
      where: { id: stemId },
      include: {
        pricing: true,
        nftMint: { select: { tokenId: true } },
        track: {
          include: {
            release: { select: { title: true, primaryArtist: true } },
          },
        },
      },
    });
  }

  private async readStemAudio(stem: NonNullable<StemRecord>) {
    const resolvedStemUrl = this.resolveStemUrl(stem.uri);
    if (stem.encryptionMetadata) {
      return this.encryptionService.decrypt(
        resolvedStemUrl,
        stem.encryptionMetadata,
        [],
        {
          address: this.x402Config.payoutAddress.toLowerCase(),
          sig: "x402-payment-verified",
          signedMessage: "Download authorized via MCP x402 payment verification",
        },
      );
    }

    const response = await fetch(resolvedStemUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch stem: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private resolveStemUrl(uri: string) {
    if (/^https?:\/\//i.test(uri)) {
      return uri;
    }

    const backendUrl =
      process.env.BACKEND_URL || process.env.PUBLIC_BACKEND_URL || "http://localhost:3000";
    return new URL(uri, backendUrl).toString();
  }

  private mcpQuoteResourceUrl(stemId: string, licenseType: QuoteLicenseKey) {
    return `mcp://resonate/tools/stem.quote/${encodeURIComponent(
      stemId,
    )}?licenseType=${licenseType}`;
  }

  private mcpDownloadResourceUrl(stemId: string, licenseType: QuoteLicenseKey) {
    return `mcp://resonate/tools/stem.download/${encodeURIComponent(
      stemId,
    )}?licenseType=${licenseType}`;
  }

  private mimeType(stem: NonNullable<StemRecord>) {
    return stem.mimeType || "audio/mpeg";
  }

  private downloadExtension(uri: string, mimeType: string) {
    const pathname = /^https?:\/\//i.test(uri) ? new URL(uri).pathname : uri;
    const existingExtension = path.extname(pathname);
    if (existingExtension) {
      return existingExtension;
    }
    if (mimeType === "audio/mp4") {
      return ".m4a";
    }
    if (mimeType === "audio/mpeg") {
      return ".mp3";
    }
    return "";
  }
}
