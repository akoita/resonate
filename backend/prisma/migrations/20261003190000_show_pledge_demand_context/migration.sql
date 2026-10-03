CREATE TABLE "ShowPledgeDemandContext" (
    "id" UUID NOT NULL,
    "pledgeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "citySlug" VARCHAR(80) NOT NULL,
    "consentPolicyVersion" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowPledgeDemandContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShowPledgeDemandContext_pledgeId_key"
    ON "ShowPledgeDemandContext"("pledgeId");
CREATE INDEX "ShowPledgeDemandContext_userId_idx"
    ON "ShowPledgeDemandContext"("userId");
CREATE INDEX "ShowPledgeDemandContext_expiresAt_idx"
    ON "ShowPledgeDemandContext"("expiresAt");

ALTER TABLE "ShowPledgeDemandContext"
    ADD CONSTRAINT "ShowPledgeDemandContext_pledgeId_fkey"
    FOREIGN KEY ("pledgeId") REFERENCES "ShowPledge"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowPledgeDemandContext"
    ADD CONSTRAINT "ShowPledgeDemandContext_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
