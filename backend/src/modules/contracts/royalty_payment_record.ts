import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

/**
 * #2344: records one `RoyaltyPaid` log as a `RoyaltyPayment`.
 *
 * A payment is identified by the (transactionHash, logIndex) of its log. It used
 * to be (transactionHash, tokenId), which dropped the second royalty of a batched
 * transaction carrying two sales of the same token. Replaying a log writes
 * nothing new.
 *
 * Rows indexed before #2344 may have no log position (the migration matches them
 * to their raw event where it can). Such a legacy row is ADOPTED, not duplicated:
 * the first log that arrives for the same (transaction, token, recipient, amount)
 * takes its place, so a reindex neither double counts it nor loses it.
 */

export type RoyaltyPaymentRecord = {
  tokenId: bigint;
  chainId: number;
  recipientAddress: string;
  amount: string;
  paymentToken: string;
  paymentAssetId: string | null;
  paymentAssetSymbol: string;
  paymentAssetDecimals: number;
  settlementAmount: string | null;
  settlementAmountUnits: string | null;
  canonicalAmountUsd: string | null;
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  paidAt: Date;
};

export type RoyaltyPaymentOutcome = "created" | "adopted" | "existing";

export async function recordRoyaltyPayment(record: RoyaltyPaymentRecord): Promise<RoyaltyPaymentOutcome> {
  const { logIndex, ...fields } = record;
  const key = { transactionHash: record.transactionHash, logIndex };
  const existing = await prisma.royaltyPayment.findUnique({
    where: { transactionHash_logIndex: key },
    select: { id: true },
  });
  if (existing) return "existing";

  const legacy = await prisma.royaltyPayment.findFirst({
    where: {
      transactionHash: record.transactionHash,
      tokenId: record.tokenId,
      logIndex: null,
      recipientAddress: record.recipientAddress,
      amount: record.amount,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (legacy) {
    // Guarded so two concurrent deliveries adopt it once.
    const adopted = await prisma.royaltyPayment.updateMany({
      where: { id: legacy.id, logIndex: null },
      data: { logIndex },
    });
    if (adopted.count > 0) return "adopted";
  }

  try {
    await prisma.royaltyPayment.create({ data: { ...fields, logIndex } });
    return "created";
  } catch (error) {
    // A concurrent delivery of the same log won the race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "existing";
    throw error;
  }
}
