-- Generalize x402 settlements beyond stems (#1462): priced Punchline moments
-- settle on the same x402 personal rail. `resourceKind` discriminates the
-- resource union; existing rows are stems (covered by the default).

-- Stems are no longer the only settleable resource — stemId becomes optional.
ALTER TABLE "X402Settlement" ALTER COLUMN "stemId" DROP NOT NULL;

-- Resource discriminator + moment linkage.
ALTER TABLE "X402Settlement" ADD COLUMN "resourceKind" TEXT NOT NULL DEFAULT 'stem';
ALTER TABLE "X402Settlement" ADD COLUMN "momentId" TEXT;

-- Indexes for the new columns.
CREATE INDEX "X402Settlement_momentId_idx" ON "X402Settlement"("momentId");
CREATE INDEX "X402Settlement_resourceKind_idx" ON "X402Settlement"("resourceKind");

-- FK to the collected moment. SET NULL on delete keeps the settlement audit row
-- (money record) even if the moment is later removed.
ALTER TABLE "X402Settlement"
  ADD CONSTRAINT "X402Settlement_momentId_fkey"
  FOREIGN KEY ("momentId") REFERENCES "PunchlineMoment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
