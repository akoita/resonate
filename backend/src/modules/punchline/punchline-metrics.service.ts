import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Artist-facing Punchline metrics (#489).
 *
 * Aggregates the funnel for one drop from two truths:
 *   - the local analytics fact store (`AnalyticsEvent`) for client funnel
 *     events (drop_viewed → preview_played → collect_started), and
 *   - the ownership tables for what actually happened (collected editions,
 *     set completions) — the DB rows, not events, so the numbers an artist
 *     sees can never drift from reality.
 *
 * Conversion = collected / views (server-side, so every consumer agrees).
 * Owner-scoped: only the drop's artist can read its metrics.
 */

export interface PunchlineMomentMetrics {
  momentId: string;
  title: string;
  previews: number;
  collectStarts: number;
  collected: number;
  editionSize: number;
  soldOut: boolean;
}

export interface PunchlineDropMetrics {
  dropId: string;
  views: number;
  previews: number;
  collectStarts: number;
  collected: number;
  totalEditions: number;
  /** collected / views, 0..1, null when there are no views yet. */
  conversion: number | null;
  setCompletions: number;
  moments: PunchlineMomentMetrics[];
}

@Injectable()
export class PunchlineMetricsService {
  async getDropMetrics(
    userId: string,
    dropId: string,
  ): Promise<PunchlineDropMetrics> {
    const drop = await prisma.punchlineDrop.findUnique({
      where: { id: dropId },
      include: {
        moments: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { collectibles: true } } },
        },
        unlocks: { include: { _count: { select: { grants: true } } } },
      },
    });
    if (!drop) {
      throw new NotFoundException(`Punchline Drop ${dropId} not found`);
    }
    const artist = await prisma.artist.findUnique({ where: { userId } });
    if (!artist || artist.id !== drop.artistId) {
      throw new ForbiddenException("You do not own this Punchline Drop.");
    }

    const [views, previews, collectStarts] = await Promise.all([
      this.countFunnelEvents("punchline.drop_viewed", dropId),
      this.countFunnelEvents("punchline.preview_played", dropId),
      this.countFunnelEvents("punchline.collect_started", dropId),
    ]);

    // Per-moment funnel splits, grouped in one pass per event kind.
    const [previewsByMoment, startsByMoment] = await Promise.all([
      this.countFunnelEventsByMoment("punchline.preview_played", dropId),
      this.countFunnelEventsByMoment("punchline.collect_started", dropId),
    ]);

    const moments: PunchlineMomentMetrics[] = drop.moments.map((moment) => ({
      momentId: moment.id,
      title: moment.title,
      previews: previewsByMoment.get(moment.id) ?? 0,
      collectStarts: startsByMoment.get(moment.id) ?? 0,
      collected: moment._count.collectibles,
      editionSize: moment.editionSize,
      soldOut: moment._count.collectibles >= moment.editionSize,
    }));

    const collected = moments.reduce((sum, m) => sum + m.collected, 0);
    const totalEditions = moments.reduce((sum, m) => sum + m.editionSize, 0);
    const setCompletions = drop.unlocks.reduce(
      (sum, unlock) => sum + unlock._count.grants,
      0,
    );

    return {
      dropId: drop.id,
      views,
      previews,
      collectStarts,
      collected,
      totalEditions,
      conversion: views > 0 ? collected / views : null,
      setCompletions,
      moments,
    };
  }

  private countFunnelEvents(
    eventName: string,
    dropId: string,
  ): Promise<number> {
    return prisma.analyticsEvent.count({
      where: {
        eventName,
        payload: { path: ["dropId"], equals: dropId },
      },
    });
  }

  private async countFunnelEventsByMoment(
    eventName: string,
    dropId: string,
  ): Promise<Map<string, number>> {
    const rows = await prisma.analyticsEvent.findMany({
      where: {
        eventName,
        payload: { path: ["dropId"], equals: dropId },
      },
      select: { payload: true },
      take: 10_000,
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      const momentId =
        row.payload &&
        typeof row.payload === "object" &&
        !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>).momentId
          : null;
      if (typeof momentId === "string") {
        counts.set(momentId, (counts.get(momentId) ?? 0) + 1);
      }
    }
    return counts;
  }
}
