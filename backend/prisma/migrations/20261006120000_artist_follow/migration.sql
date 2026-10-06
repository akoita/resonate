CREATE TABLE "ArtistFollow" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistFollow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtistFollow_userId_artistId_key"
    ON "ArtistFollow"("userId", "artistId");
CREATE INDEX "ArtistFollow_artistId_createdAt_idx"
    ON "ArtistFollow"("artistId", "createdAt");

ALTER TABLE "ArtistFollow"
    ADD CONSTRAINT "ArtistFollow_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistFollow"
    ADD CONSTRAINT "ArtistFollow_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "Artist"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
