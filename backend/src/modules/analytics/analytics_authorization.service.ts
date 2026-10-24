import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { auditAdminBranch } from "../admin_audit/admin_branch_audit";
import { auditRef } from "../admin_audit/admin_audit.interceptor";

export interface AnalyticsRequestUser {
  userId?: string;
  role?: string;
}

@Injectable()
export class AnalyticsAuthorizationService {
  assertCanReadAgentQualityDashboard(user: AnalyticsRequestUser | undefined) {
    if (user?.role === "admin" || user?.role === "operator") {
      return;
    }

    throw new ForbiddenException("AI DJ quality analytics are restricted to operators");
  }

  async assertCanReadArtistMetrics(artistId: string, user: AnalyticsRequestUser | undefined) {
    if (user?.role === "admin") {
      // #2380: an admin reading another artist's analytics is recorded; their own is not.
      const artist = await prisma.artist.findUnique({
        where: { id: artistId },
        select: { userId: true },
      });
      await auditAdminBranch(user, "artist_analytics.support_viewed", {
        targetUserId: artist?.userId ?? null,
        detail: { artistId: auditRef(artistId) },
      });
      return;
    }

    if (user?.role === "agent") {
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
