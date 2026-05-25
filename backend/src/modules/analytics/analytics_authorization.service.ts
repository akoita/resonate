import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

export interface AnalyticsRequestUser {
  userId?: string;
  role?: string;
}

@Injectable()
export class AnalyticsAuthorizationService {
  async assertCanReadArtistMetrics(artistId: string, user: AnalyticsRequestUser | undefined) {
    if (user?.role === "admin") {
      return;
    }

    if (!user?.userId) {
      throw new ForbiddenException("Missing authenticated user for artist analytics");
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { userId: true },
    });

    if (!artist || artist.userId !== user.userId) {
      throw new ForbiddenException("Artist analytics are restricted to the artist owner");
    }
  }
}
