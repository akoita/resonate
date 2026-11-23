-- #2596: card disputes over Artist Pro invoices.
ALTER TABLE "StripeDispute" ADD COLUMN "subscriptionInvoiceId" TEXT;
CREATE INDEX "StripeDispute_subscriptionInvoiceId_status_idx" ON "StripeDispute"("subscriptionInvoiceId", "status");
ALTER TABLE "StripeDispute" ADD CONSTRAINT "StripeDispute_subscriptionInvoiceId_fkey" FOREIGN KEY ("subscriptionInvoiceId") REFERENCES "SubscriptionInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Subscription" ADD COLUMN "disputeHoldUntil" TIMESTAMP(3);
