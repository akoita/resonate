import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

export interface AnalyticsTrackMetadata {
  trackId: string;
  title: string;
  releaseId: string;
  releaseTitle: string;
  artistId: string;
  artistName: string | null;
}

@Injectable()
export class AnalyticsCatalogMetadataService {
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
          },
        },
      },
    });

    return new Map(
      tracks.map((track) => [
        track.id,
        {
          trackId: track.id,
          title: track.title,
          releaseId: track.releaseId,
          releaseTitle: track.release.title,
          artistId: track.release.artistId,
          artistName: track.release.artist.displayName || track.release.primaryArtist || null,
        },
      ]),
    );
  }
}
