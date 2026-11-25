-- #2670: uploads refused by an upload limit, counted on the preview measures page.
CREATE TABLE "UploadLimitRefusal" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "limitKey" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadLimitRefusal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadLimitRefusal_createdAt_idx" ON "UploadLimitRefusal"("createdAt");

CREATE INDEX "UploadLimitRefusal_artistId_idx" ON "UploadLimitRefusal"("artistId");
