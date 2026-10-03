CREATE TABLE "SceneScoutCityDemand" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "releaseTitle" TEXT NOT NULL,
    "citySlug" VARCHAR(80) NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "resonantListeners" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "follows" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "pledges" INTEGER NOT NULL DEFAULT 0,
    "uniqueListeners" INTEGER NOT NULL,
    "signalCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneScoutCityDemand_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SceneScoutCityDemand_windowDays_check" CHECK ("windowDays" IN (7, 28)),
    CONSTRAINT "SceneScoutCityDemand_counts_check" CHECK (
        "resonantListeners" >= 0 AND "saves" >= 0 AND "follows" >= 0 AND
        "purchases" >= 0 AND "pledges" >= 0 AND "uniqueListeners" >= 0 AND "signalCount" >= 0
    ),
    CONSTRAINT "SceneScoutCityDemand_artistId_fkey"
        FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SceneScoutCityDemand_releaseId_fkey"
        FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SceneScoutCityDemand_artist_release_city_window_key"
    ON "SceneScoutCityDemand"("artistId", "releaseId", "countryCode", "citySlug", "windowDays");
CREATE INDEX "SceneScoutCityDemand_artistId_computedAt_idx"
    ON "SceneScoutCityDemand"("artistId", "computedAt");
