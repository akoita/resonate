import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

export interface AnalyticsTrackMetadata {
  trackId: string;
  title: string;
  releaseId: string;
  releaseTitle: string;
  artistId: string;
  artistName: string | null;
  managerArtistId: string;
  managerArtistName: string | null;
  creditedArtistId: string | null;
  creditedArtistName: string | null;
  creditedArtistIds: string[];
  creditedArtistNames: string[];
}

@Injectable()
export class AnalyticsCatalogMetadataService {
  /**
   * #1743: punchline product events carry a dropId rather than a trackId, so
   * server-side artist attribution resolves through the drop's own artist
   * column. Returns dropId -> artistId for the drops that exist.
   */
  async findPunchlineDropArtists(dropIds: string[]): Promise<Map<string, string>> {
    const uniqueDropIds = [...new Set(dropIds.filter((dropId) => dropId && dropId !== "unknown"))];
    if (uniqueDropIds.length === 0) {
      return new Map();
    }

    const drops = await prisma.punchlineDrop.findMany({
      where: { id: { in: uniqueDropIds } },
      select: { id: true, artistId: true },
    });

    return new Map(drops.map((drop) => [drop.id, drop.artistId]));
  }

  async findTracks(trackIds: string[]): Promise<Map<string, AnalyticsTrackMetadata>> {
    const uniqueTrackIds = [...new Set(trackIds.filter((trackId) => trackId && trackId !== "unknown"))];
    if (uniqueTrackIds.length === 0) {
      return new Map();
    }

    const tracks = await prisma.track.findMany({
      where: { id: { in: uniqueTrackIds } },
      select: {
        id: true,
        title: true,
        releaseId: true,
        release: {
          select: {
            title: true,
            artistId: true,
            primaryArtist: true,
            artist: { select: { displayName: true } },
            artistCredits: {
              orderBy: [{ sortOrder: "asc" }, { role: "asc" }],
              select: {
                artistId: true,
                displayName: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return new Map(
      tracks.map((track) => {
        const mainCredits = track.release.artistCredits.filter((credit) =>
          ["main", "primary"].includes(credit.role.toLowerCase()),
        );
        const creditedArtistIds = mainCredits.map((credit) => credit.artistId);
        const creditedArtistNames = mainCredits.map((credit) => credit.displayName).filter(Boolean);
        const creditedArtistName = creditedArtistNames.join(", ")
          || track.release.primaryArtist
          || track.release.artist.displayName
          || null;
        const managerArtistName = track.release.artist.displayName || null;

        return [
          track.id,
          {
            trackId: track.id,
            title: track.title,
            releaseId: track.releaseId,
            releaseTitle: track.release.title,
            artistId: track.release.artistId,
            artistName: creditedArtistName,
            managerArtistId: track.release.artistId,
            managerArtistName,
            creditedArtistId: creditedArtistIds[0] ?? null,
            creditedArtistName,
            creditedArtistIds,
            creditedArtistNames,
          },
        ];
      }),
    );
  }
}
