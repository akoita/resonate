ALTER TABLE "Dispute"
ADD COLUMN "escalatedToJuryAt" TIMESTAMP(3),
ADD COLUMN "juryDeadlineAt" TIMESTAMP(3),
ADD COLUMN "jurySize" INTEGER,
ADD COLUMN "juryVotesForReporter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "juryVotesForCreator" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "juryFinalizedAt" TIMESTAMP(3);

CREATE TABLE "DisputeJurorAssignment" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "jurorAddr" TEXT NOT NULL,
    "vote" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "votedAt" TIMESTAMP(3),

    CONSTRAINT "DisputeJurorAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DisputeJurorAssignment_disputeId_jurorAddr_key"
ON "DisputeJurorAssignment"("disputeId", "jurorAddr");

CREATE INDEX "DisputeJurorAssignment_jurorAddr_idx"
ON "DisputeJurorAssignment"("jurorAddr");

CREATE INDEX "DisputeJurorAssignment_disputeId_idx"
ON "DisputeJurorAssignment"("disputeId");

ALTER TABLE "DisputeJurorAssignment"
ADD CONSTRAINT "DisputeJurorAssignment_disputeId_fkey"
FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
