import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { X402Config } from "../x402/x402.config";
import { PaymentsService } from "../payments/payments.service";
import { resolveX402AssetInfo, type X402AssetInfo } from "../x402/x402.public";
import { formatUsdcAmount, toUsdBreakdown, toX402TokenAmount } from "../x402/x402.quote";
import {
  X402_TX_HASH_PATTERN,
  createX402PublicClient,
  findVerifiedUsdcTransfer,
} from "../x402/x402.smart-account";
import {
  PunchlineCollectException,
  PunchlineCollectService,
} from "./punchline-collect.service";

/**
 * Paid Punchline moment collects on the x402 personal rail (#1462).
 *
 * A priced moment ($0.50–$9.99 per edition, canonical band) is settled with the
 * same x402 machinery as stems: the fan's Resonate passkey wallet transfers
 * USDC to the single payout address, the backend verifies the on-chain Transfer,
 * and then grants the edition + records the settlement in ONE transaction. The
 * take-rate is the existing personal tier `feeBps` (1500) — no new fee class.
 *
 * Money-safety invariants:
 *   - fail-closed: no edition is granted unless the exact payment is verified;
 *   - idempotent: re-posting the same txHash returns the original result and
 *     never double-grants (the one-per-fan unique backstops the replay check);
 *   - honest: a verified payment that cannot be fulfilled (sold out / already
 *     owned) is recorded `refund_due` and surfaced as `paid_but_unfulfilled`.
 *     Automatic refunds are out of scope — settlement is the durable record an
 *     operator reconciles from (see docs/features/punchline_drops_mvp.md).
 */

const PAID_RESOURCE_KIND = "punchline_moment";
const PAID_RAIL = "smart_account";

type SmartAccountCollectBody = {
  txHash?: string;
  payer?: string;
  collectorWallet?: string | null;
};

type LoadedMoment = {
  id: string;
  priceCents: number;
  editionSize: number;
  title: string;
  drop: { id: string; trackId: string; artistId: string; status: string };
};

@Injectable()
export class PunchlineX402Service {
  private readonly logger = new Logger(PunchlineX402Service.name);

  constructor(
    private readonly x402Config: X402Config,
    private readonly collectService: PunchlineCollectService,
    private readonly eventBus: EventBus,
    @Optional() private readonly paymentsService?: PaymentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Quote
  // ---------------------------------------------------------------------------

  /**
   * Public x402 quote for a priced, published, still-collectable moment. Honest
   * 4xx for free / sold-out / not-published / not-found, and a 503 when the
   * x402 rail is not configured on this server.
   */
  async buildMomentQuote(momentId: string) {
    const moment = await this.loadPricedMoment(momentId);
    const collected = await prisma.punchlineCollectible.count({
      where: { momentId: moment.id },
    });
    if (collected >= moment.editionSize) {
      throw new ConflictException({
        code: "sold_out",
        message: "All editions of this moment have been collected.",
      });
    }

    const asset = this.resolveAssetInfo();
    const amountUsd = moment.priceCents / 100;
    const feeBps = this.x402Config.licensePricing.personal.feeBps;
    const amountUnits = toX402TokenAmount(amountUsd, asset.decimals);

    return {
      momentId: moment.id,
      resourceKind: PAID_RESOURCE_KIND,
      priceCents: moment.priceCents,
      amountUsd,
      currency: asset.symbol,
      displayPrice: `${formatUsdcAmount(amountUsd)} ${asset.symbol}`,
      breakdown: toUsdBreakdown(amountUsd, feeBps),
      network: this.x402Config.network,
      chainId: this.x402Config.chainId,
      payTo: this.x402Config.payoutAddress,
      asset: {
        assetId: asset.assetId,
        address: asset.address,
        symbol: asset.symbol,
        name: asset.name,
        version: asset.version,
        decimals: asset.decimals,
      },
      amountUnits,
      editionSize: moment.editionSize,
      collected,
      editionsRemaining: Math.max(0, moment.editionSize - collected),
      collectEndpoint: `/punchline/moments/${moment.id}/collect/smart-account`,
    };
  }

  // ---------------------------------------------------------------------------
  // Paid collect (smart-account human path)
  // ---------------------------------------------------------------------------

  async collectWithSmartAccount(
    userId: string,
    momentId: string,
    body: SmartAccountCollectBody,
  ) {
    if (!this.x402Config.enabled) {
      throw new ServiceUnavailableException({
        code: "payments_unavailable",
        message: "Paid collecting is not available on this server.",
      });
    }
    if (!body?.txHash || !X402_TX_HASH_PATTERN.test(body.txHash)) {
      throw new BadRequestException({
        code: "invalid_tx_hash",
        message: "A valid payment transaction hash is required.",
      });
    }
    if (!body?.payer) {
      throw new BadRequestException({
        code: "invalid_payer",
        message: "A paying smart-account address is required.",
      });
    }

    const txHash = body.txHash as `0x${string}`;
    let payer: Address;
    try {
      payer = getAddress(body.payer);
    } catch {
      throw new BadRequestException({
        code: "invalid_payer",
        message: "A valid paying smart-account address is required.",
      });
    }
    const paymentProof = `smart-account:${payer}:${txHash}`;
    const paymentProofSha256 = createHash("sha256")
      .update(paymentProof)
      .digest("hex");

    const moment = await this.loadPricedMoment(momentId);

    // Idempotency / replay: a prior settlement for this exact payment wins.
    const existing = await prisma.x402Settlement.findFirst({
      where: {
        OR: [
          { paymentTransactionHash: txHash },
          { paymentProofSha256 },
        ],
      },
    });
    if (existing) {
      if (
        existing.resourceKind !== PAID_RESOURCE_KIND ||
        existing.momentId !== moment.id
      ) {
        throw new ConflictException({
          code: "payment_redeemed_elsewhere",
          message:
            "This payment has already been redeemed for a different collectible.",
        });
      }
      if (existing.status === "refund_due") {
        throw this.paidButUnfulfilled();
      }
      const original = await this.collectService.describeExistingCollect(
        userId,
        moment.id,
      );
      if (original) {
        return original;
      }
      // Settlement exists but no grant for this user — treat as owed.
      throw this.paidButUnfulfilled();
    }

    // Verify the on-chain payment. Failure is honest and non-granting.
    const asset = this.resolveAssetInfo();
    const amountUsd = moment.priceCents / 100;
    const amountUnits = toX402TokenAmount(amountUsd, asset.decimals);
    try {
      await this.verifyMomentPayment({ txHash, payer, amountUnits, asset });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `x402 moment payment verification failed for ${moment.id}: ${message}`,
      );
      this.publishFailed(moment, {
        transactionHash: txHash,
        status: "verification_failed",
        reason: message,
      });
      throw new HttpException(
        { code: "payment_verification_failed", message },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const settlementData = this.buildMomentSettlementData({
      moment,
      payer,
      txHash,
      paymentProofSha256,
      asset,
      amountUsd,
      amountUnits,
      status: "collected",
    });

    try {
      const collectible =
        await this.collectService.allocatePaidEditionWithSettlement(
          userId,
          moment.id,
          {
            editionSize: moment.editionSize,
            collectorWallet: this.normalizeWallet(body.collectorWallet ?? body.payer),
            pricePaidCents: moment.priceCents,
            paymentRef: txHash,
          },
          settlementData,
        );

      this.eventBus.publish({
        eventName: "x402.purchase",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        resourceKind: PAID_RESOURCE_KIND,
        momentId: moment.id,
        trackId: moment.drop.trackId,
        artistId: moment.drop.artistId,
        receiptId: settlementData.receiptId,
        paymentRail: "smart_account",
        transactionHash: txHash,
        amountUsd,
        canonicalAmountUsd: amountUsd,
        paymentToken: asset.address,
        paymentAssetId: asset.assetId,
        paymentAssetSymbol: asset.symbol,
        paymentAssetDecimals: asset.decimals,
        settlementAmount: formatUsdcAmount(amountUsd),
        settlementAmountUnits: amountUnits,
        settlementStatus: "collected",
        entitlement: "punchline_edition",
        payer,
      });

      return this.collectService.finalizeCollect(userId, moment, collectible);
    } catch (error) {
      if (
        error instanceof PunchlineCollectException &&
        (error.code === "sold_out" || error.code === "already_collected")
      ) {
        // Verified payment we cannot fulfill — record the debt, don't grant.
        await this.recordRefundDue(settlementData, moment, txHash, error.code);
        throw this.paidButUnfulfilled();
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Overridable in tests: reads the on-chain payment receipt. */
  getPublicClient() {
    if (!this.x402Config.rpcUrl) {
      throw new Error(
        `X402_RPC_URL is required for smart-account x402 verification on chain ${this.x402Config.chainId}`,
      );
    }
    return createX402PublicClient(this.x402Config.chainId, this.x402Config.rpcUrl);
  }

  private async verifyMomentPayment(input: {
    txHash: `0x${string}`;
    payer: Address;
    amountUnits: string;
    asset: X402AssetInfo;
  }) {
    const payTo = getAddress(this.x402Config.payoutAddress);
    const assetAddress = getAddress(input.asset.address);

    const receipt = await this.getPublicClient().waitForTransactionReceipt({
      hash: input.txHash,
      timeout: 60_000,
    });
    if (receipt.status !== "success") {
      throw new Error("The smart-account payment transaction reverted.");
    }

    const transfer = findVerifiedUsdcTransfer(receipt, {
      assetAddress,
      payer: input.payer,
      payTo,
      minAmountUnits: BigInt(input.amountUnits),
    });
    if (!transfer) {
      throw new Error(
        "No matching USDC transfer to the x402 payout address was found.",
      );
    }
  }

  private buildMomentSettlementData(input: {
    moment: LoadedMoment;
    payer: Address;
    txHash: `0x${string}`;
    paymentProofSha256: string;
    asset: X402AssetInfo;
    amountUsd: number;
    amountUnits: string;
    status: "collected" | "refund_due";
  }) {
    const normalizedAmount = formatUsdcAmount(input.amountUsd);
    const receiptId = `x402r_${randomUUID()}`;
    const receipt = {
      receiptId,
      version: "1",
      type: "resonate.x402.purchase_receipt",
      protocol: "x402",
      purchasedAt: new Date().toISOString(),
      resource: {
        kind: PAID_RESOURCE_KIND,
        momentId: input.moment.id,
        momentTitle: input.moment.title,
        dropId: input.moment.drop.id,
        trackId: input.moment.drop.trackId,
        artistId: input.moment.drop.artistId,
      },
      payment: {
        protocol: "x402",
        scheme: "exact",
        network: this.x402Config.network,
        payTo: this.x402Config.payoutAddress,
        currency: input.asset.symbol,
        amount: normalizedAmount,
        amountUsd: normalizedAmount,
        canonicalAmountUsd: normalizedAmount,
        settlementAmount: normalizedAmount,
        settlementAmountUnits: input.amountUnits,
        asset: {
          assetId: input.asset.assetId,
          tokenAddress: input.asset.address,
          symbol: input.asset.symbol,
          decimals: input.asset.decimals,
        },
        paymentProofSha256: input.paymentProofSha256,
      },
      settlement: {
        rail: "x402",
        status: input.status,
        entitlement: "punchline_edition",
        transactionHash: input.txHash,
      },
      provenance: {
        eventName: "x402.purchase",
        transactionHash: input.txHash,
      },
    };

    return {
      resourceKind: PAID_RESOURCE_KIND,
      momentId: input.moment.id,
      payerAddress: input.payer.toLowerCase(),
      paymentRail: PAID_RAIL,
      paymentProofSha256: input.paymentProofSha256,
      paymentTransactionHash: input.txHash,
      receiptId,
      receipt,
      status: input.status,
      contractSettlementStatus: "not_applicable",
      paymentToken: input.asset.address,
      paymentAssetId: input.asset.assetId,
      paymentAssetSymbol: input.asset.symbol,
      paymentAssetDecimals: input.asset.decimals,
      settlementAmount: normalizedAmount,
      settlementAmountUnits: input.amountUnits,
      canonicalAmountUsd: normalizedAmount,
      purchasedAt: new Date(),
    };
  }

  /**
   * Record the `refund_due` debt for a verified-but-unfulfillable payment. The
   * original collected attempt rolled back, so this insert reuses the txHash.
   * A unique collision means a settlement already landed concurrently — the
   * debt is already recorded, so we swallow it and still surface the honest
   * error to the fan.
   */
  private async recordRefundDue(
    collectedData: ReturnType<PunchlineX402Service["buildMomentSettlementData"]>,
    moment: LoadedMoment,
    txHash: `0x${string}`,
    reason: string,
  ) {
    try {
      await prisma.x402Settlement.create({
        data: {
          ...collectedData,
          status: "refund_due",
          contractSettlementReason: `paid_but_unfulfilled:${reason}`,
          receiptId: `x402r_${randomUUID()}`,
          receipt: {
            ...(collectedData.receipt as Record<string, unknown>),
            settlement: {
              rail: "x402",
              status: "refund_due",
              entitlement: "punchline_edition",
              reason,
              transactionHash: txHash,
            },
          },
        },
      });
    } catch (error) {
      this.logger.warn(
        `refund_due settlement insert skipped for moment ${moment.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.publishFailed(moment, {
      transactionHash: txHash,
      status: "refund_due",
      reason: `paid_but_unfulfilled:${reason}`,
    });
  }

  private paidButUnfulfilled() {
    return new ConflictException({
      code: "paid_but_unfulfilled",
      message:
        "Your payment went through but this edition could no longer be collected (sold out or already owned). Support will refund you — no edition was granted.",
    });
  }

  private publishFailed(
    moment: LoadedMoment,
    input: { transactionHash: string; status: string; reason: string },
  ) {
    this.eventBus.publish({
      eventName: "x402.purchase_failed",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      resourceKind: PAID_RESOURCE_KIND,
      momentId: moment.id,
      trackId: moment.drop.trackId,
      artistId: moment.drop.artistId,
      paymentRail: "smart_account",
      transactionHash: input.transactionHash,
      status: input.status,
      reason: input.reason,
    });
  }

  private async loadPricedMoment(momentId: string): Promise<LoadedMoment> {
    const moment = await prisma.punchlineMoment.findUnique({
      where: { id: momentId },
      select: {
        id: true,
        priceCents: true,
        editionSize: true,
        title: true,
        drop: {
          select: { id: true, trackId: true, artistId: true, status: true },
        },
      },
    });
    if (!moment) {
      throw new NotFoundException({
        code: "moment_not_found",
        message: `Moment ${momentId} was not found.`,
      });
    }
    if (moment.drop.status !== "published") {
      throw new NotFoundException({
        code: "drop_not_published",
        message: "This drop is not published, so its moments cannot be collected.",
      });
    }
    if (moment.priceCents <= 0) {
      throw new BadRequestException({
        code: "free_moment",
        message: "This moment is free — collect it directly, no payment needed.",
      });
    }
    return moment as LoadedMoment;
  }

  private resolveAssetInfo(): X402AssetInfo {
    return resolveX402AssetInfo(
      this.x402Config.network,
      this.paymentsService?.getPaymentAssets(this.x402Config.chainId).assets,
    );
  }

  private normalizeWallet(wallet?: string | null): string | null {
    if (typeof wallet !== "string") return null;
    const trimmed = wallet.trim();
    return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : null;
  }
}
