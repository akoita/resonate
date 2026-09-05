-- Punchline collectible payment provenance (#485).
-- Free claims record rail "free_claim" / 0 cents; a paid rail fills paymentRef
-- once x402 is generalized beyond stems. One collectible per collector per
-- moment is enforced at the database level.

-- AlterTable
ALTER TABLE "PunchlineCollectible" ADD COLUMN     "paymentRail" TEXT NOT NULL DEFAULT 'free_claim',
ADD COLUMN     "pricePaidCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PunchlineCollectible_momentId_collectorUserId_key" ON "PunchlineCollectible"("momentId", "collectorUserId");
