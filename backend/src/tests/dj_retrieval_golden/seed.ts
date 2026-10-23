/**
 * Postgres seeding for the integration golden runners (#2235, #2242). Kept apart
 * from the harness so the Docker-free runner never imports the Prisma client.
 * Tests only.
 */
import { prisma } from "../../db/prisma";
import { GOLDEN_CATALOG, GoldenTrack } from "./fixtures";
import { stemFeaturesPayload } from "./harness";


/**
 * Seeds the golden catalog under `prefix` (user, uploader, releases, tracks and
 * original stems with their measured features), newest first and newer than
 * anything another suite left behind. The caller tags the tracks.
 */
export async function seedGoldenCatalog(prefix: string, catalog: readonly GoldenTrack[] = GOLDEN_CATALOG): Promise<{ userId: string; artistId: string }> {
  const userId = `${prefix}user`;
  const artistId = `${prefix}uploader`;
  await prisma.user.create({ data: { id: userId, email: `${prefix}@test.resonate` } });
  await prisma.artist.create({
    data: {
      id: artistId,
      userId,
      displayName: "Fixture uploader",
      payoutAddress: `0x${"d".repeat(40)}`,
    },
  });
  const newest = Date.now() + 60_000;
  const createdAt = (index: number) => new Date(newest - index * 1000);
  await prisma.release.createMany({
    data: catalog.map((track, index) => ({
      id: `${prefix}rel_${track.key}`,
      artistId,
      title: track.releaseTitle ?? track.title,
      primaryArtist: track.artist,
      genre: track.genre,
      moods: track.moods ?? [],
      status: "published",
      createdAt: createdAt(index),
    })),
  });
  await prisma.track.createMany({
    data: catalog.map((track, index) => ({
      id: `${prefix}${track.key}`,
      releaseId: `${prefix}rel_${track.key}`,
      title: track.title,
      artist: track.artist,
      explicit: Boolean(track.explicit),
      position: 1,
      createdAt: createdAt(index),
    })),
  });
  await prisma.stem.createMany({
    data: catalog.map((track) => ({
      id: `${prefix}stem_${track.key}`,
      trackId: `${prefix}${track.key}`,
      type: "original",
      uri: `local://${prefix}${track.key}.wav`,
      isCurrent: true,
      durationSeconds: 200,
      ...(track.measured ? { audioFeatures: stemFeaturesPayload(track.measured) } : {}),
    })),
  });
  return { userId, artistId };
}

/** Removes what `seedGoldenCatalog` (and the tagger and embedder) wrote under `prefix`. */
export async function cleanGoldenCatalog(prefix: string): Promise<void> {
  const ignore = () => undefined;
  await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: prefix } } }).catch(ignore);
  await prisma.trackDescriptor.deleteMany({ where: { trackId: { startsWith: prefix } } }).catch(ignore);
  await prisma.stem.deleteMany({ where: { trackId: { startsWith: prefix } } }).catch(ignore);
  await prisma.track.deleteMany({ where: { id: { startsWith: prefix } } }).catch(ignore);
  await prisma.release.deleteMany({ where: { id: { startsWith: prefix } } }).catch(ignore);
  await prisma.artist.deleteMany({ where: { id: `${prefix}uploader` } }).catch(ignore);
  await prisma.user.deleteMany({ where: { id: `${prefix}user` } }).catch(ignore);
}
