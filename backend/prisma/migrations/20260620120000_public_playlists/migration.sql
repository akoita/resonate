-- Public playlists (#1216): playlists are private by default but can be made
-- public so other listeners can view, play, and save them. SavedPlaylist is a
-- live reference (re-resolved through the public endpoint), so owner edits
-- propagate and a source that goes private/deleted reads as unavailable.

-- Visibility column on Playlist (existing rows stay private).
ALTER TABLE "Playlist" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

CREATE INDEX "Playlist_visibility_idx" ON "Playlist"("visibility");
CREATE INDEX "Playlist_userId_idx" ON "Playlist"("userId");

-- Saved (followed) public playlists.
CREATE TABLE "SavedPlaylist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourcePlaylistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedPlaylist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedPlaylist_userId_sourcePlaylistId_key" ON "SavedPlaylist"("userId", "sourcePlaylistId");
CREATE INDEX "SavedPlaylist_userId_idx" ON "SavedPlaylist"("userId");
CREATE INDEX "SavedPlaylist_sourcePlaylistId_idx" ON "SavedPlaylist"("sourcePlaylistId");

ALTER TABLE "SavedPlaylist" ADD CONSTRAINT "SavedPlaylist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SavedPlaylist" ADD CONSTRAINT "SavedPlaylist_sourcePlaylistId_fkey" FOREIGN KEY ("sourcePlaylistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
