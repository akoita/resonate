import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { isSurfaceEnabled } from "../../config/product_surfaces";
import { NoticeService } from "../notifications/notice.service";
import { sceneScoutMinimumAudience } from "../scene_scout/scene_scout.service";
import { writeStructuredLog } from "../shared/structured_logging";
import { SHOW_CAMPAIGN_MODES, SHOW_INTEREST_CITY_MAX, type ShowCampaignMode } from "./show-interest.dto";
import { PUBLIC_DISCOVERY_EXCLUDED_CAMPAIGN_STATUSES, ShowsService } from "./shows.service";

type Actor = { userId: string; role?: string };

/** Recipients per targeted notice call (the notice service's own cap is 1000). */
const NOTIFY_BATCH = 500;

export interface ShowInterestState {
  mode: ShowCampaignMode;
  /** Whether this campaign takes "I would come" declarations now. */
  open: boolean;
  mine: { city: string | null; notifyWhenOpen: boolean; createdAt: string } | null;
}

export interface ShowInterestSummary {
  mode: ShowCampaignMode;
  total: number;
  /** Cities with at least `minimumGroup` people, largest first. */
  cities: Array<{ city: string; count: number }>;
  /** People in smaller cities, or who gave no city, counted together. */
  otherCount: number;
  /** People who asked to be told when tickets or pledges open. */
  notifyCount: number;
  minimumGroup: number;
}

function normalizeCity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const city = value.replace(/\s+/g, " ").trim();
  if (!city) return null;
  if (city.length > SHOW_INTEREST_CITY_MAX) throw new BadRequestException("city is too long");
  return city;
}

/** Group key: case- and accent-insensitive, so "Lyon" and "lyon" count together. */
function cityKey(city: string): string {
  return city.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Shows "I would come" (#2668): a campaign in `interest` mode collects
 * declarations of interest instead of pledges. No payment, escrow or contract
 * call. Artists and operators see counts by city under the minimum-group
 * rule; the artist can later move the campaign to pledge mode, and people who
 * asked to be told get a notice.
 */
@Injectable()
export class ShowInterestService {
  constructor(
    private readonly shows: ShowsService,
    @Optional() private readonly notices?: NoticeService,
  ) {}

  async getState(campaignId: string, userId: string | null): Promise<ShowInterestState> {
    const campaign = await this.findCampaign(campaignId);
    const mine = userId
      ? await prisma.showInterest.findUnique({ where: { campaignId_userId: { campaignId: campaign.id, userId } } })
      : null;
    return {
      mode: campaign.mode as ShowCampaignMode,
      open: this.acceptsInterest(campaign),
      mine: mine ? { city: mine.city, notifyWhenOpen: mine.notifyWhenOpen, createdAt: mine.createdAt.toISOString() } : null,
    };
  }

  /** Declare (or update) one account's interest. One row per account per campaign. */
  async declare(actor: Actor, campaignId: string, input: { city?: string; notifyWhenOpen?: boolean }) {
    const campaign = await this.findCampaign(campaignId);
    if (campaign.mode !== "interest") {
      throw new BadRequestException({ code: "show_not_in_interest_mode", message: "This show is not collecting interest" });
    }
    if (!this.acceptsInterest(campaign)) {
      throw new BadRequestException({ code: "show_interest_closed", message: "This show no longer collects interest" });
    }
    const city = normalizeCity(input?.city);
    const notifyWhenOpen = input?.notifyWhenOpen === true;
    const row = await prisma.showInterest.upsert({
      where: { campaignId_userId: { campaignId: campaign.id, userId: actor.userId } },
      create: { campaignId: campaign.id, userId: actor.userId, city, notifyWhenOpen },
      update: { city, notifyWhenOpen },
    });
    writeStructuredLog({
      level: "info",
      event: "shows.interest_declared",
      message: "Show interest declared",
      campaignId: campaign.id,
      withCity: Boolean(city),
      notifyWhenOpen,
    });
    return { city: row.city, notifyWhenOpen: row.notifyWhenOpen, createdAt: row.createdAt.toISOString() };
  }

  /** Withdraw: the declaration is deleted. Withdrawing nothing is fine. */
  async withdraw(actor: Actor, campaignId: string) {
    const campaign = await this.findCampaign(campaignId);
    const result = await prisma.showInterest.deleteMany({ where: { campaignId: campaign.id, userId: actor.userId } });
    return { withdrawn: result.count > 0 };
  }

  /** Counts by city for the campaign's artist or an operator. */
  async summary(actor: Actor, campaignId: string): Promise<ShowInterestSummary> {
    const managed = await this.shows.getManagedCampaign(actor, campaignId);
    const campaign = await this.findCampaign(managed.id);
    const rows = await prisma.showInterest.findMany({
      where: { campaignId: campaign.id },
      select: { city: true, notifyWhenOpen: true },
    });
    return summarizeInterest(rows, campaign.mode as ShowCampaignMode, sceneScoutMinimumAudience());
  }

  /**
   * Set how a campaign runs. Interest mode is only for a campaign that has no
   * pledges. Moving to pledge mode needs pledging to be available, and tells
   * everyone who asked to be told, once.
   */
  async setMode(actor: Actor, campaignId: string, mode: string) {
    if (!(SHOW_CAMPAIGN_MODES as readonly string[]).includes(mode)) {
      throw new BadRequestException("mode is not recognised");
    }
    const managed = await this.shows.getManagedCampaign(actor, campaignId);
    const campaign = await this.findCampaign(managed.id);
    if (campaign.mode === mode) return { id: campaign.id, mode, notified: 0 };

    if (mode === "interest") {
      const pledges = await prisma.showPledge.count({ where: { campaignId: campaign.id } });
      if (pledges > 0 || campaign.status !== "draft") {
        throw new ConflictException({
          code: "show_interest_requires_no_pledges",
          message: "Only a draft campaign with no pledges can collect interest instead",
        });
      }
      await prisma.showCampaign.update({ where: { id: campaign.id }, data: { mode } });
      return { id: campaign.id, mode, notified: 0 };
    }

    if (!isSurfaceEnabled("showsPledging")) {
      throw new ConflictException({
        code: "show_pledging_unavailable",
        message: "Pledges are not available yet, so this show keeps collecting interest",
      });
    }
    await prisma.showCampaign.update({ where: { id: campaign.id }, data: { mode } });
    const notified = await this.notifyOpened(campaign);
    return { id: campaign.id, mode, notified };
  }

  private async notifyOpened(campaign: { id: string; slug: string; title: string }): Promise<number> {
    if (!this.notices) return 0;
    const rows = await prisma.showInterest.findMany({
      where: { campaignId: campaign.id, notifyWhenOpen: true },
      select: { userId: true },
    });
    let created = 0;
    for (let i = 0; i < rows.length; i += NOTIFY_BATCH) {
      const userIds = rows.slice(i, i + NOTIFY_BATCH).map((row) => row.userId);
      const result = await this.notices.sendTargeted(
        {
          userIds,
          category: "service",
          title: `Pledges are open: ${campaign.title}`.slice(0, 120),
          body:
            "You asked to be told when this show opens. You can now pledge to help make it happen. "
            + "Nothing is charged unless you choose to pledge.",
          link: `/shows/${campaign.slug}`,
        },
        { userId: "system:shows" },
        { dedupeKey: `show_interest_open:${campaign.id}` },
      );
      created += result.created;
    }
    return created;
  }

  private acceptsInterest(campaign: { mode: string; status: string; deadline: Date }): boolean {
    return (
      campaign.mode === "interest"
      && !(PUBLIC_DISCOVERY_EXCLUDED_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status)
      && campaign.deadline.getTime() > Date.now()
    );
  }

  private async findCampaign(slugOrId: string) {
    const select = { id: true, slug: true, title: true, mode: true, status: true, deadline: true } as const;
    const campaign =
      (await prisma.showCampaign.findUnique({ where: { id: slugOrId }, select }))
      ?? (await prisma.showCampaign.findUnique({ where: { slug: slugOrId }, select }));
    if (!campaign) throw new NotFoundException("Show campaign not found");
    return campaign;
  }
}

/**
 * Counts by city. A city with fewer than `minimumGroup` people is folded into
 * `otherCount`, so nobody in a small town can be singled out. Pure for tests.
 */
export function summarizeInterest(
  rows: Array<{ city: string | null; notifyWhenOpen: boolean }>,
  mode: ShowCampaignMode,
  minimumGroup: number,
): ShowInterestSummary {
  const groups = new Map<string, { city: string; count: number }>();
  let noCity = 0;
  for (const row of rows) {
    if (!row.city) {
      noCity += 1;
      continue;
    }
    const key = cityKey(row.city);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { city: row.city, count: 1 });
  }
  const cities: Array<{ city: string; count: number }> = [];
  let otherCount = noCity;
  for (const group of groups.values()) {
    if (group.count >= minimumGroup) cities.push(group);
    else otherCount += group.count;
  }
  cities.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  return {
    mode,
    total: rows.length,
    cities,
    otherCount,
    notifyCount: rows.filter((row) => row.notifyWhenOpen).length,
    minimumGroup,
  };
}
