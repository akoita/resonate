import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { sceneScoutMinimumAudience } from "../scene_scout/scene_scout.service";
import { summarizeInterest, type ShowInterestSummary } from "../shows/show-interest-summary";
import type { ShowCampaignMode } from "../shows/show-interest.dto";

/**
 * #2686: Shows "I would come" counts in artist analytics. One entry per
 * interest-mode campaign of the artist, built with the same summary the
 * campaign page uses (`summarizeInterest`), so both always agree and no city
 * below the minimum group is ever named. Counts only: no person, account or
 * email leaves this source.
 */

export const ARTIST_SHOW_INTEREST_SOURCE = Symbol("ARTIST_SHOW_INTEREST_SOURCE");

/** Newest campaigns first; older ones stay on their campaign pages. */
export const ARTIST_SHOW_INTEREST_CAMPAIGN_LIMIT = 10;

export type ArtistShowInterestCampaign = {
  campaignId: string;
  slug: string;
  title: string;
  city: string;
  status: string;
  deadline: string;
  interest: ShowInterestSummary;
};

export type ArtistShowInterest = {
  status: "ready" | "none" | "unavailable";
  reason?: string;
  minimumGroup: number;
  campaigns: ArtistShowInterestCampaign[];
};

export interface ArtistShowInterestSource {
  getArtistShowInterest(artistId: string): Promise<ArtistShowInterest>;
}

@Injectable()
export class PrismaArtistShowInterestSource implements ArtistShowInterestSource {
  async getArtistShowInterest(artistId: string): Promise<ArtistShowInterest> {
    const minimumGroup = sceneScoutMinimumAudience();
    const campaigns = await prisma.showCampaign.findMany({
      where: { artistId, mode: "interest" },
      select: { id: true, slug: true, title: true, city: true, status: true, deadline: true, mode: true },
      orderBy: { createdAt: "desc" },
      take: ARTIST_SHOW_INTEREST_CAMPAIGN_LIMIT,
    });
    if (campaigns.length === 0) return { status: "none", minimumGroup, campaigns: [] };
    const rows = await prisma.showInterest.findMany({
      where: { campaignId: { in: campaigns.map((campaign) => campaign.id) } },
      select: { campaignId: true, city: true, notifyWhenOpen: true },
    });
    const byCampaign = new Map<string, Array<{ city: string | null; notifyWhenOpen: boolean }>>();
    for (const row of rows) {
      const list = byCampaign.get(row.campaignId) ?? [];
      list.push({ city: row.city, notifyWhenOpen: row.notifyWhenOpen });
      byCampaign.set(row.campaignId, list);
    }
    return {
      status: "ready",
      minimumGroup,
      campaigns: campaigns.map((campaign) => ({
        campaignId: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
        city: campaign.city,
        status: campaign.status,
        deadline: campaign.deadline.toISOString(),
        interest: summarizeInterest(
          byCampaign.get(campaign.id) ?? [],
          campaign.mode as ShowCampaignMode,
          minimumGroup,
        ),
      })),
    };
  }
}
