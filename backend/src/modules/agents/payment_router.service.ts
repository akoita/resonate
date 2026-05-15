import { Injectable, Optional } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { AgentPurchaseInput, AgentPurchaseService } from "./agent_purchase.service";
import type { AgentLicenseType } from "./agent_runtime.types";
import {
  AgentPaymentRail,
  PolicyGuardService,
  type PolicyGuardResult,
} from "./policy_guard.service";
import { X402Config } from "../x402/x402.config";
import {
  X402PaymentChallenge,
  X402PaymentService,
} from "../x402/x402.payment.service";
import { buildStemX402Receipt } from "../x402/x402.receipt";
import { getX402ChainId, resolveX402AssetInfo } from "../x402/x402.public";
import { PaymentsService } from "../payments/payments.service";

export interface PaymentRouterInput extends Partial<AgentPurchaseInput> {
  sessionId: string;
  userId: string;
  rail?: AgentPaymentRail;
  licenseType?: AgentLicenseType;
  priceUsd?: number;
  budgetRemainingUsd: number;
  allowedRails?: AgentPaymentRail[];
  allowedLicenseTypes?: AgentLicenseType[];
  stemId?: string;
  paymentProof?: string;
  paymentRequirements?: unknown;
  resourceUrl?: string;
}

export interface PaymentRouterResult {
  success: boolean;
  rail: AgentPaymentRail;
  status: "confirmed" | "rejected" | "failed" | "payment_required";
  reason?: string;
  message?: string;
  transactionId?: string;
  txHash?: string;
  remaining?: number;
  priceUsd?: number;
  licenseType?: AgentLicenseType;
  stemId?: string;
  paymentChallenge?: X402PaymentChallenge;
  paymentRequirements?: unknown;
  receiptId?: string;
  receipt?: ReturnType<typeof buildStemX402Receipt>;
  policy?: PolicyGuardResult;
}

type X402Stem = NonNullable<Awaited<ReturnType<PaymentRouterService["findX402Stem"]>>>;

@Injectable()
export class PaymentRouterService {
  constructor(
    private readonly policyGuard: PolicyGuardService,
    @Optional()
    private readonly erc4337Rail?: AgentPurchaseService,
    @Optional()
    private readonly x402Rail?: X402PaymentService,
    @Optional()
    private readonly x402Config?: X402Config,
    @Optional()
    private readonly paymentsService?: PaymentsService,
  ) {}

  async purchase(input: PaymentRouterInput): Promise<PaymentRouterResult> {
    const rail = input.rail ?? "erc4337_marketplace";
    const licenseType = input.licenseType ?? "personal";
    if (rail === "x402") {
      return this.purchaseWithX402({ ...input, rail, licenseType });
    }

    if (!this.hasErc4337Fields(input)) {
      return {
        success: false,
        rail,
        status: "rejected",
        reason: "invalid_erc4337_purchase_input",
      };
    }

    if (!this.erc4337Rail) {
      return {
        success: false,
        rail,
        status: "rejected",
        reason: "erc4337_not_configured",
      };
    }

    const policy = this.policyGuard.evaluate({
      sessionId: input.sessionId,
      userId: input.userId,
      rail,
      licenseType,
      priceUsd: input.priceUsd,
      budgetRemainingUsd: input.budgetRemainingUsd,
      allowedRails: input.allowedRails,
      allowedLicenseTypes: input.allowedLicenseTypes,
    });

    if (!policy.allowed) {
      return {
        success: false,
        rail,
        status: "rejected",
        reason: policy.reason,
        remaining: policy.remainingUsd,
        policy,
      };
    }

    const result = await this.erc4337Rail.purchase(input);
    if (result.success) {
      return {
        success: true,
        rail,
        status: "confirmed",
        transactionId: result.transactionId,
        txHash: result.txHash,
        remaining: result.remaining,
        policy,
      };
    }

    return {
      success: false,
      rail,
      status: "failed",
      reason: result.reason,
      message: result.message,
      transactionId: result.transactionId,
      remaining: result.remaining ?? policy.remainingUsd,
      policy,
    };
  }

  private async purchaseWithX402(
    input: PaymentRouterInput & { rail: "x402"; licenseType: AgentLicenseType },
  ): Promise<PaymentRouterResult> {
    if (!this.x402Rail || !this.x402Config?.enabled || !this.x402Config.payoutAddress) {
      return {
        success: false,
        rail: "x402",
        status: "rejected",
        reason: "x402_not_configured",
      };
    }

    if (!input.stemId) {
      return {
        success: false,
        rail: "x402",
        status: "rejected",
        reason: "stem_required",
      };
    }

    const stem = await this.findX402Stem(input.stemId);
    if (!stem) {
      return {
        success: false,
        rail: "x402",
        status: "rejected",
        reason: "stem_not_found",
        stemId: input.stemId,
      };
    }

    const amountUsd = this.x402Rail.resolveLicenseAmountUsd(
      stem.pricing,
      input.licenseType,
    );
    const paymentChallenge = await this.x402Rail.buildPaymentChallenge({
      stemId: stem.id,
      licenseType: input.licenseType,
      resourceUrl: input.resourceUrl ?? `/api/stems/${stem.id}/x402`,
      description: `Purchase ${input.licenseType} license for stem ${stem.id} via agent x402 rail`,
      mimeType: this.mimeType(stem),
    });
    const policy = this.policyGuard.evaluate({
      sessionId: input.sessionId,
      userId: input.userId,
      rail: "x402",
      licenseType: input.licenseType,
      priceUsd: amountUsd,
      budgetRemainingUsd: input.budgetRemainingUsd,
      allowedRails: input.allowedRails,
      allowedLicenseTypes: input.allowedLicenseTypes,
    });

    if (!policy.allowed) {
      return {
        success: false,
        rail: "x402",
        status: "rejected",
        reason: policy.reason,
        remaining: policy.remainingUsd,
        priceUsd: amountUsd,
        licenseType: input.licenseType,
        stemId: stem.id,
        policy,
      };
    }

    if (!input.paymentProof) {
      return {
        success: false,
        rail: "x402",
        status: "payment_required",
        reason: "payment_required",
        remaining: policy.remainingUsd,
        priceUsd: amountUsd,
        licenseType: input.licenseType,
        stemId: stem.id,
        paymentChallenge,
        paymentRequirements: paymentChallenge.paymentRequirements,
        policy,
      };
    }

    const verified = await this.x402Rail.verifyAndSettle(
      input.paymentProof,
      input.paymentRequirements ?? paymentChallenge.paymentRequirements,
    );
    if (!verified.ok) {
      return {
        success: false,
        rail: "x402",
        status: "failed",
        reason: verified.reason,
        remaining: policy.remainingUsd,
        priceUsd: amountUsd,
        licenseType: input.licenseType,
        stemId: stem.id,
        paymentChallenge,
        paymentRequirements: paymentChallenge.paymentRequirements,
        policy,
      };
    }

    const purchasedAt = new Date();
    const transactionHash = `x402:agent:${stem.id}:${purchasedAt.getTime()}`;
    const assetInfo = resolveX402AssetInfo(
      this.x402Config.network,
      this.paymentsService?.getPaymentAssets(this.x402Config.chainId).assets,
    );
    const receipt = buildStemX402Receipt({
      stemId: stem.id,
      stemType: stem.type,
      stemTitle: stem.title ?? null,
      trackTitle: stem.track?.title ?? null,
      artist: stem.track?.release?.primaryArtist ?? null,
      releaseTitle: stem.track?.release?.title ?? null,
      hasNft: !!stem.nftMint,
      tokenId: stem.nftMint?.tokenId?.toString() ?? null,
      licenseKey: input.licenseType,
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
      resource: input.resourceUrl ?? `/api/stems/${stem.id}/x402`,
      quoteUrl: `/api/stems/${stem.id}/x402/info`,
      mimeType: this.mimeType(stem),
      contentLength: 0,
      eventTransactionHash: transactionHash,
      paymentHeader: input.paymentProof,
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
          source: "agent_payment_router",
          sessionId: input.sessionId,
          userId: input.userId,
          stemId: stem.id,
          stemType: stem.type,
          trackId: stem.trackId,
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

    return {
      success: true,
      rail: "x402",
      status: "confirmed",
      reason: "payment_confirmed",
      transactionId: receipt.receiptId,
      txHash: transactionHash,
      remaining: policy.remainingUsd,
      priceUsd: amountUsd,
      licenseType: input.licenseType,
      stemId: stem.id,
      receiptId: receipt.receiptId,
      receipt,
      policy,
    };
  }

  private hasErc4337Fields(input: PaymentRouterInput): input is PaymentRouterInput & AgentPurchaseInput {
    return (
      input.rail === undefined ||
      input.rail === "erc4337_marketplace"
    ) && input.listingId !== undefined &&
      input.tokenId !== undefined &&
      input.amount !== undefined &&
      input.totalPriceWei !== undefined &&
      input.priceUsd !== undefined;
  }

  private findX402Stem(stemId: string) {
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

  private mimeType(stem: X402Stem) {
    return stem.mimeType || "audio/mpeg";
  }

  private toTokenAmount(amount: number, decimals: number): string {
    const [intPart, decPart = ""] = String(amount).split(".");
    const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
    return (intPart + paddedDec).replace(/^0+/, "") || "0";
  }
}
