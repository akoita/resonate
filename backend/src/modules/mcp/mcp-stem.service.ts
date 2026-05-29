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
import { MCP_ERROR_RECOVERY, type McpErrorCode } from "./mcp.constants";

export type McpStemQuote = {
  summary: string;
  stemId: string;
  licenseType: QuoteLicenseKey;
  priceUsdc: string;
  expiresAt: string;
  availableActions: McpAvailableAction[];
  rights: McpStemRightsSummary;
  policy: McpStemPolicySummary;
  docs: McpDocsLinks;
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

type McpDocsLinks = {
  mcp: string;
  x402: string;
  externalAgentContract: string;
};

type McpAvailableAction = {
  action: string;
  description: string;
  tool?: string;
  method?: string;
  href?: string;
  requiresPayment?: boolean;
};

type McpStemRightsSummary = {
  licenseType: QuoteLicenseKey;
  stemId: string;
  artist: string | null;
  trackTitle: string | null;
  releaseTitle: string | null;
  usage: string;
  attribution: string;
  constraints: string[];
};

type McpStemPolicySummary = {
  paymentRequired: boolean;
  proofRequiredForDownload: boolean;
  quoteExpiresAt: string;
  retry: string;
  publicRouter: boolean;
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
export type McpToolFailureContext = Record<string, unknown> & {
  stemId?: string;
  licenseType?: QuoteLicenseKey;
  cause?: string;
};

export class McpToolError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly context: McpToolFailureContext = {},
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

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
    if (!verified.ok) {
      return this.paymentFailure(quote, verified.reason);
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
      summary: `Purchased ${licenseType} license for ${this.stemDisplayName(stem)}.`,
      stemId: stem.id,
      licenseType,
      receiptId: receipt.receiptId,
      availableActions: [
        {
          action: "store_receipt",
          description:
            "Persist the receipt ID, encoded receipt, license, payment asset, and settlement status.",
        },
        {
          action: "save_resource",
          description:
            "Save or hand off the embedded MCP audio resource according to the requested license.",
        },
        {
          action: "retry_idempotently_on_transport_failure",
          description:
            "If the client loses the response after payment, retry with the same proof only when the payment client/facilitator supports idempotent settlement.",
          tool: "stem.download",
          requiresPayment: true,
        },
      ],
      receiptVerification: {
        receiptId: receipt.receiptId,
        encodedReceiptPresent: true,
        paymentProofSha256: receipt.payment.paymentProofSha256,
        settlementStatus: receipt.settlement.status,
        licenseKey: receipt.license.key,
        paymentAsset: receipt.payment.asset,
        resource: {
          uri: resourceUri,
          mimeType: this.mimeType(stem),
          bytes: audioBuffer.length,
        },
        checklist: [
          "Store the encoded receipt and receipt ID before exposing the resource to downstream tools.",
          "Verify the receipt license key, stem ID, amount, payment asset, and settlement status match the human-approved quote.",
          "Do not treat failed or missing settlement status as a license grant without operator policy.",
        ],
      },
      docs: this.docsLinks(),
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
    const priceUsdc = formatUsdcAmount(amountUsd);
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString();

    return {
      summary: `Quote ${priceUsdc} USDC for ${licenseType} license on ${this.stemDisplayName(stem)}.`,
      stemId: stem.id,
      licenseType,
      priceUsdc,
      expiresAt,
      availableActions: [
        {
          action: "explain_quote",
          description:
            "Explain the price, license tier, payment network, expiration, and stem context to the human user before payment.",
        },
        {
          action: "satisfy_x402_challenge",
          description:
            "Create an x402 payment proof against the returned payment requirements.",
          requiresPayment: true,
        },
        {
          action: "download_after_payment",
          description:
            "Call stem.download with the same stem ID, license tier, and paymentProof.",
          tool: "stem.download",
          href: this.mcpDownloadResourceUrl(stem.id, licenseType),
          requiresPayment: true,
        },
      ],
      rights: this.rightsSummary(stem, licenseType),
      policy: {
        paymentRequired: true,
        proofRequiredForDownload: true,
        quoteExpiresAt: expiresAt,
        retry:
          "Request a fresh stem.quote after expiration or when payment requirements change.",
        publicRouter: false,
      },
      docs: this.docsLinks(),
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

  private rightsSummary(
    stem: NonNullable<StemRecord>,
    licenseType: QuoteLicenseKey,
  ): McpStemRightsSummary {
    return {
      licenseType,
      stemId: stem.id,
      artist: stem.track?.release?.primaryArtist ?? null,
      trackTitle: stem.track?.title ?? null,
      releaseTitle: stem.track?.release?.title ?? null,
      usage:
        licenseType === "personal"
          ? "Personal listening or evaluation of the purchased stem."
          : licenseType === "remix"
            ? "Remix-oriented use subject to the returned receipt and platform license terms."
            : "Commercial-oriented use subject to the returned receipt and platform license terms.",
      attribution:
        "Retain stem, track, artist, release, license, and receipt context when handing this resource to downstream tools.",
      constraints: [
        "The quote is not a license grant until payment is verified and a receipt is returned.",
        "The receipt is the durable proof of license tier, amount, asset, stem, and settlement status.",
        "Additional platform or artist terms may apply outside this MCP response.",
      ],
    };
  }

  private paymentRequired(quote: McpStemQuote, message: string) {
    const structuredContent = {
      code: "PAYMENT_REQUIRED",
      message,
      recovery: MCP_ERROR_RECOVERY.PAYMENT_REQUIRED,
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

  private paymentFailure(quote: McpStemQuote, reason: string) {
    const code = this.mapPaymentFailureCode(reason);
    const structuredContent = {
      code,
      message:
        code === "PAYMENT_PROOF_INVALID"
          ? "The paymentProof could not be verified by the x402 facilitator."
          : "The x402 facilitator could not complete verification or settlement.",
      recovery: MCP_ERROR_RECOVERY[code],
      reason,
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

  private stemDisplayName(stem: NonNullable<StemRecord>) {
    const title = stem.title || stem.type || stem.id;
    const trackTitle = stem.track?.title;
    const artist = stem.track?.release?.primaryArtist;
    if (trackTitle && artist) {
      return `${title} from ${trackTitle} by ${artist}`;
    }
    if (trackTitle) {
      return `${title} from ${trackTitle}`;
    }
    return title;
  }

  private docsLinks(): McpDocsLinks {
    return {
      mcp: "docs/architecture/mcp_server.md",
      x402: "docs/architecture/x402_payments.md",
      externalAgentContract:
        "docs/architecture/external_agent_application_contract.md",
    };
  }

  private async requireDownloadableStem(stemId: string) {
    const stem = await this.findStem(stemId);
    if (!stem) {
      throw new McpToolError("RESOURCE_NOT_FOUND", `Stem ${stemId} not found`, {
        stemId,
      });
    }
    if (!stem.uri) {
      throw new McpToolError(
        "RESOURCE_UNAVAILABLE",
        `Stem ${stemId} has no downloadable file`,
        { stemId },
      );
    }
    return stem;
  }

  private assertX402Enabled() {
    if (!this.x402Config.enabled || !this.x402Config.payoutAddress) {
      throw new McpToolError(
        "X402_DISABLED",
        "x402 payments are not enabled on this server",
      );
    }
  }

  private mapPaymentFailureCode(reason: string): McpErrorCode {
    if (reason.startsWith("payment_proof_decode_failed")) {
      return "PAYMENT_PROOF_INVALID";
    }
    if (reason.startsWith("settle_failed")) {
      return "SETTLEMENT_FAILED";
    }
    if (reason.startsWith("facilitator_http_")) {
      return "FACILITATOR_FAILED";
    }
    if (reason.startsWith("facilitator_unreachable")) {
      return "FACILITATOR_FAILED";
    }
    return "PAYMENT_PROOF_INVALID";
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
          internalKey: process.env.INTERNAL_SERVICE_KEY,
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
