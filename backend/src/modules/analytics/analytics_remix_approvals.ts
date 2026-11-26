import { prisma } from "../../db/prisma";
import type { ArtistActionCard } from "./analytics.service";

/**
 * #1121: a next-step card when remix creators are waiting for the artist's
 * approval of a version (#2682). The count is of requests addressed to this
 * artist, so no listener threshold applies.
 */

export const ARTIST_REMIX_APPROVAL_SOURCE = Symbol("ARTIST_REMIX_APPROVAL_SOURCE");

export interface ArtistRemixApprovalSource {
  countPendingApprovals(artistId: string): Promise<number>;
}

export class PrismaArtistRemixApprovalSource implements ArtistRemixApprovalSource {
  async countPendingApprovals(artistId: string): Promise<number> {
    return prisma.remixApprovalRequest.count({
      where: { sourceArtistId: artistId, status: "pending", remixProject: { status: "draft" } },
    });
  }
}

export function remixApprovalCards(pending: number | undefined): ArtistActionCard[] {
  if (!pending || pending < 1) return [];
  const plural = pending === 1 ? "remix is" : "remixes are";
  return [
    {
      id: "review_remix_approvals",
      type: "review_remix_approvals",
      title: "Answer remix approval requests",
      description: `${pending} ${plural} waiting for your approval before they can be shared.`,
      reason: "You asked to approve AI-assisted remixes of your music. Listen to each version, then approve or decline it.",
      priority: "high",
      confidence: 0.9,
      sourceSignal: { category: "remix", summary: "Remix versions waiting for your answer", count: pending },
      cta: { label: "Review remix approvals", href: "/artist/remix-approvals" },
      privacy: { aggregateOnly: true, thresholdApplied: false },
    },
  ];
}
