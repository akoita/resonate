-- #2299 persisted AI DJ pick notes: the bounded, vocabulary-only explanation of
-- each pick-log License, so Session History shows the reason from any backend
-- instance and after a restart. One row per License (the primary key is the
-- license id) and deleted with it. `userId` is the session owner, so account
-- erasure can delete the note directly while the License itself is retained.

-- CreateTable
CREATE TABLE "AgentPickNote" (
    "licenseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "explanation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasonCode" TEXT,
    "curatedBy" TEXT NOT NULL,
    "requestMatch" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPickNote_pkey" PRIMARY KEY ("licenseId")
);

-- CreateIndex
CREATE INDEX "AgentPickNote_userId_idx" ON "AgentPickNote"("userId");

-- AddForeignKey
ALTER TABLE "AgentPickNote" ADD CONSTRAINT "AgentPickNote_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPickNote" ADD CONSTRAINT "AgentPickNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
