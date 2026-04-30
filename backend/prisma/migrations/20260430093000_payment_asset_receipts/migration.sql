-- Preserve payment asset identity on indexed payment-bearing records.

ALTER TABLE "StemPurchase"
ADD COLUMN "paymentToken" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
ADD COLUMN "paymentAssetId" TEXT,
ADD COLUMN "paymentAssetSymbol" TEXT NOT NULL DEFAULT 'ETH',
ADD COLUMN "paymentAssetDecimals" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN "settlementAmount" TEXT,
ADD COLUMN "settlementAmountUnits" TEXT,
ADD COLUMN "canonicalAmountUsd" TEXT;

ALTER TABLE "RoyaltyPayment"
ADD COLUMN "paymentToken" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
ADD COLUMN "paymentAssetId" TEXT,
ADD COLUMN "paymentAssetSymbol" TEXT NOT NULL DEFAULT 'ETH',
ADD COLUMN "paymentAssetDecimals" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN "settlementAmount" TEXT,
ADD COLUMN "settlementAmountUnits" TEXT,
ADD COLUMN "canonicalAmountUsd" TEXT;

ALTER TABLE "ContentProtectionStake"
ADD COLUMN "paymentToken" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
ADD COLUMN "paymentAssetId" TEXT,
ADD COLUMN "paymentAssetSymbol" TEXT NOT NULL DEFAULT 'ETH',
ADD COLUMN "paymentAssetDecimals" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN "settlementAmount" TEXT,
ADD COLUMN "settlementAmountUnits" TEXT,
ADD COLUMN "canonicalAmountUsd" TEXT;

ALTER TABLE "Dispute"
ADD COLUMN "counterStakeToken" TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
ADD COLUMN "counterStakeAssetId" TEXT,
ADD COLUMN "counterStakeAssetSymbol" TEXT NOT NULL DEFAULT 'ETH',
ADD COLUMN "counterStakeAssetDecimals" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN "counterStakeAmount" TEXT,
ADD COLUMN "counterStakeAmountUnits" TEXT,
ADD COLUMN "counterStakeAmountUsd" TEXT,
ADD COLUMN "appealStakeToken" TEXT,
ADD COLUMN "appealStakeAssetId" TEXT,
ADD COLUMN "appealStakeAssetSymbol" TEXT,
ADD COLUMN "appealStakeAssetDecimals" INTEGER,
ADD COLUMN "appealStakeAmount" TEXT,
ADD COLUMN "appealStakeAmountUnits" TEXT,
ADD COLUMN "appealStakeAmountUsd" TEXT;

CREATE INDEX "StemPurchase_paymentToken_idx" ON "StemPurchase"("paymentToken");
CREATE INDEX "RoyaltyPayment_paymentToken_idx" ON "RoyaltyPayment"("paymentToken");
CREATE INDEX "ContentProtectionStake_paymentToken_idx" ON "ContentProtectionStake"("paymentToken");
CREATE INDEX "Dispute_counterStakeToken_idx" ON "Dispute"("counterStakeToken");
