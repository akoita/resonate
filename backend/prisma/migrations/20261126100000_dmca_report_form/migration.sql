-- #2664: fields captured by the public report form, and the reviewer's statement of reasons.
ALTER TABLE "DmcaReport" ADD COLUMN "claimantCapacity" TEXT,
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'copyright',
ADD COLUMN "contentLocation" TEXT,
ADD COLUMN "goodFaithAt" TIMESTAMP(3),
ADD COLUMN "statementOfReasons" TEXT;
