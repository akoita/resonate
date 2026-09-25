-- Operator credit-request queue (#1885). A user out of generation credits asks
-- an operator for a top-up; operators grant or dismiss the request in-app.
-- CreateTable
CREATE TABLE "GenerationCreditRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "grantedCents" INTEGER,
    "resolutionNote" TEXT,

    CONSTRAINT "GenerationCreditRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationCreditRequest_status_requestedAt_idx" ON "GenerationCreditRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "GenerationCreditRequest_userId_status_idx" ON "GenerationCreditRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "GenerationCreditRequest" ADD CONSTRAINT "GenerationCreditRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
