-- #2666: participation agreement acceptance and artist consent choices.
ALTER TABLE "Artist" ADD COLUMN "aiRemixApproval" TEXT NOT NULL DEFAULT 'not_required',
ADD COLUMN "aiSourceUse" TEXT NOT NULL DEFAULT 'allowed',
ADD COLUMN "stemListing" TEXT NOT NULL DEFAULT 'allowed';

-- CreateTable
CREATE TABLE "ParticipationAcceptance" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "textHash" CHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipationAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistConsentChange" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setting" VARCHAR(32) NOT NULL,
    "previousValue" VARCHAR(32),
    "value" VARCHAR(32) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistConsentChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipationAcceptance_userId_idx" ON "ParticipationAcceptance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationAcceptance_artistId_version_key" ON "ParticipationAcceptance"("artistId", "version");

-- CreateIndex
CREATE INDEX "ArtistConsentChange_artistId_changedAt_idx" ON "ArtistConsentChange"("artistId", "changedAt");

-- CreateIndex
CREATE INDEX "ArtistConsentChange_userId_idx" ON "ArtistConsentChange"("userId");

-- AddForeignKey
ALTER TABLE "ParticipationAcceptance" ADD CONSTRAINT "ParticipationAcceptance_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistConsentChange" ADD CONSTRAINT "ArtistConsentChange_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationAcceptance" ADD CONSTRAINT "ParticipationAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistConsentChange" ADD CONSTRAINT "ArtistConsentChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
