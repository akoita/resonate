-- Refund reconciliation for x402 settlements (#1506, #1462 follow-up). A
-- verified payment that could not be fulfilled (moment sold out / already owned
-- in the race window) is recorded `status = 'refund_due'`. That state was
-- terminal and invisible; operators now reconcile it by sending the out-of-band
-- refund and marking the row `refunded`. These columns hold that handoff.

-- On-chain hash of the operator's refund transfer back to the payer.
ALTER TABLE "X402Settlement" ADD COLUMN "refundTxHash" TEXT;

-- When the settlement was flipped from `refund_due` to `refunded`.
ALTER TABLE "X402Settlement" ADD COLUMN "refundedAt" TIMESTAMP(3);
