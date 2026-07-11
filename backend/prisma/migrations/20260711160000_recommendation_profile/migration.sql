-- Durable discovery state (#1448 WS-1): per-user preferences + served history,
-- replacing per-process in-memory Maps.

-- CreateTable
CREATE TABLE "RecommendationProfile" (
    "userId" TEXT NOT NULL,
    "preferences" JSONB,
    "preferencesUpdatedAt" TIMESTAMP(3),
    "servedTrackIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationProfile_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "RecommendationProfile" ADD CONSTRAINT "RecommendationProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
