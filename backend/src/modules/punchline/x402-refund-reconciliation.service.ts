import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Operator reconciliation for `refund_due` x402 settlements (#1506, #1462
 * follow-up).
 *
 * Paid Punchline moment collects settle on the x402 personal rail. When a
 * payment verifies on-chain but the edition can no longer be allocated (sold
 * out / already owned in the race window), the rail records
 * `X402Settlement.status = "refund_due"` and never grants an edition. That row
 * is the durable debt: the fan paid and is owed an out-of-band refund.
 *
 * This service is the operator surface over that debt — list the outstanding
 * refunds, and mark one refunded once the operator has sent the money back and
 * has the on-chain refund tx hash. It never moves funds itself; the transfer is
 * a manual, human-verified step (see docs/operations/x402_refund_due_runbook.md).
 */

const REFUND_DUE_STATUS = "refund_due";
const REFUNDED_STATUS = "refunded";

/** 0x-prefixed 32-byte transaction hash. */
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type RefundDueRow = {
  id: string;
  receiptId: string;
  payerAddress: string | null;
  paymentTransactionHash: string | null;
  settlementAmount: string;
  settlementAmountUnits: string;
  paymentAssetSymbol: string;
  canonicalAmountUsd: string | null;
  momentId: string | null;
  momentTitle: string | null;
  reason: string | null;
  createdAt: Date;
  ageHours: number;
};

type SettlementWithMoment = {
  id: string;
  receiptId: string;
  payerAddress: string | null;
  paymentTransactionHash: string | null;
  settlementAmount: string;
  settlementAmountUnits: string;
  paymentAssetSymbol: string;
  canonicalAmountUsd: string | null;
  momentId: string | null;
  contractSettlementReason: string | null;
  createdAt: Date;
  moment: { title: string } | null;
};

@Injectable()
export class X402RefundReconciliationService {
  private readonly logger = new Logger(X402RefundReconciliationService.name);

  /**
   * Every outstanding `refund_due` settlement, oldest first, shaped for the
   * operator surface. `ageHours` is computed from `createdAt` so operators can
   * see how long a fan has been waiting.
   */
  async listRefundDue(): Promise<RefundDueRow[]> {
    const rows = (await prisma.x402Settlement.findMany({
      where: { status: REFUND_DUE_STATUS },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        receiptId: true,
        payerAddress: true,
        paymentTransactionHash: true,
        settlementAmount: true,
        settlementAmountUnits: true,
        paymentAssetSymbol: true,
        canonicalAmountUsd: true,
        momentId: true,
        contractSettlementReason: true,
        createdAt: true,
        moment: { select: { title: true } },
      },
    })) as SettlementWithMoment[];

    const now = Date.now();
    return rows.map((row) => this.toRow(row, now));
  }

  /**
   * Mark a `refund_due` settlement `refunded` after an operator has sent the
   * out-of-band refund. Validates the refund tx hash, requires the row to still
   * be `refund_due` (409 otherwise, so a double-mark can't overwrite), and never
   * touches the immutable `receipt` JSON — the receipt is the record as issued.
   */
  async markRefunded(id: string, refundTxHash: string, actorUserId: string) {
    const normalizedHash = typeof refundTxHash === "string" ? refundTxHash.trim() : "";
    if (!TX_HASH_PATTERN.test(normalizedHash)) {
      throw new BadRequestException({
        code: "invalid_refund_tx_hash",
        message:
          "A valid 0x-prefixed 32-byte refund transaction hash is required.",
      });
    }

    const settlement = await prisma.x402Settlement.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        payerAddress: true,
        settlementAmount: true,
        paymentAssetSymbol: true,
      },
    });
    if (!settlement) {
      throw new NotFoundException({
        code: "settlement_not_found",
        message: `x402 settlement ${id} was not found.`,
      });
    }
    if (settlement.status !== REFUND_DUE_STATUS) {
      throw new ConflictException({
        code: "not_refund_due",
        message: `Settlement ${id} is "${settlement.status}", not "${REFUND_DUE_STATUS}" — it cannot be marked refunded.`,
      });
    }

    const updated = await prisma.x402Settlement.update({
      where: { id },
      data: {
        status: REFUNDED_STATUS,
        refundTxHash: normalizedHash,
        refundedAt: new Date(),
      },
    });

    this.logger.log(
      `x402 settlement ${id} marked refunded by ${actorUserId}: ` +
        `${settlement.settlementAmount} ${settlement.paymentAssetSymbol} → ` +
        `${settlement.payerAddress ?? "unknown payer"} (refundTx ${normalizedHash})`,
    );

    return updated;
  }

  private toRow(row: SettlementWithMoment, now: number): RefundDueRow {
    const ageMs = now - row.createdAt.getTime();
    const ageHours = Math.max(0, ageMs / (60 * 60 * 1000));
    return {
      id: row.id,
      receiptId: row.receiptId,
      payerAddress: row.payerAddress,
      paymentTransactionHash: row.paymentTransactionHash,
      settlementAmount: row.settlementAmount,
      settlementAmountUnits: row.settlementAmountUnits,
      paymentAssetSymbol: row.paymentAssetSymbol,
      canonicalAmountUsd: row.canonicalAmountUsd,
      momentId: row.momentId,
      momentTitle: row.moment?.title ?? null,
      reason: row.contractSettlementReason,
      createdAt: row.createdAt,
      ageHours: Math.round(ageHours * 100) / 100,
    };
  }
}
