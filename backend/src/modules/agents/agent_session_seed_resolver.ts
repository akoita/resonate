import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { cleanSeedLabel, parseSessionSeedShape, type SessionSeed } from "./agent_session_seed";

/**
 * Resolves a client seed for `userId`:
 *  - track: must exist; label is its title;
 *  - artist: `id` is the catalog Artist id; label is its display name;
 *  - playlist: must be owned by `userId` or public, else 403 (a missing
 *    playlist answers the same 403, so a private id cannot be probed).
 * Throws 400 for a malformed seed or a track/artist that does not exist.
 */
export async function resolveSessionSeed(userId: string, raw: unknown): Promise<SessionSeed> {
  const seed = parseSessionSeedShape(raw);
  if (!seed) throw new BadRequestException({ reason: "seed_invalid" });
  if (seed.kind === "playlist") {
    const playlist = await prisma.playlist.findFirst({
      where: { id: seed.id, OR: [{ userId }, { visibility: "public" }] },
      select: { id: true, name: true },
    });
    if (!playlist) throw new ForbiddenException({ reason: "seed_playlist_forbidden" });
    return { kind: "playlist", id: playlist.id, label: cleanSeedLabel(playlist.name) || seed.label };
  }
  if (seed.kind === "artist") {
    const artist = await prisma.artist.findUnique({
      where: { id: seed.id },
      select: { id: true, displayName: true },
    });
    if (!artist) throw new BadRequestException({ reason: "seed_not_found" });
    return { kind: "artist", id: artist.id, label: cleanSeedLabel(artist.displayName) || seed.label };
  }
  const track = await prisma.track.findUnique({
    where: { id: seed.id },
    select: { id: true, title: true },
  });
  if (!track) throw new BadRequestException({ reason: "seed_not_found" });
  return { kind: "track", id: track.id, label: cleanSeedLabel(track.title) || seed.label };
}

