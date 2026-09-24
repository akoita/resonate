import Link from "next/link";
import {
  campaignDisplayTitle,
  daysUntil,
  progressRatio,
  type Campaign,
} from "../../lib/shows";
import { CampaignPoster } from "../shows/CampaignPoster";
import { HomeCampaignVisual } from "./HomeCampaignVisual";
import { HomeShelf } from "./HomeShelf";

/*
 * Home v3 "Upcoming Live Events" — ticket-style campaign cards on a shelf.
 *
 * Every card is one link to the campaign page, which is where backing
 * happens, so the "Back this show" line never promises anything the
 * destination doesn't do. Funding numbers come straight from the campaign
 * (raised/goal, backers, deadline); nothing is estimated.
 */

const MAX_EVENTS = 8;

function formatShowDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function TicketCard({ campaign }: { campaign: Campaign }) {
  const title = campaignDisplayTitle(campaign);
  const image = campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url;
  const pct = Math.round(progressRatio(campaign) * 100);
  const days = daysUntil(campaign.deadline);
  const showDate = formatShowDate(campaign.targetDate);
  const place = campaign.venue || campaign.city;

  return (
    <Link href={`/shows/${campaign.id}`} className="ng-ticket">
      <div className={`ng-ticket__art ${image ? "ng-ticket__art--image" : "ng-ticket__art--poster"}`}>
        {image ? (
          <HomeCampaignVisual
            src={image}
            sizes="(max-width: 767px) 78vw, 300px"
            className="ng-ticket__image"
          />
        ) : (
          <CampaignPoster campaign={campaign} />
        )}
        <span className="ng-ticket__shade" aria-hidden />
        {showDate ? <span className="ng-ticket__date">{showDate}</span> : null}
      </div>
      <div className="ng-ticket__perf" aria-hidden />
      <div className="ng-ticket__stub">
        <h4 className="ng-ticket__title">{title}</h4>
        {place ? <p className="ng-ticket__place">{place}</p> : null}
        <div
          className="ng-ticket__progress"
          role="progressbar"
          aria-label="Funding progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="ng-ticket__stats">
          <strong>{pct}% funded</strong>
          <span aria-hidden>·</span>
          <span>
            {campaign.backerCount} backer{campaign.backerCount === 1 ? "" : "s"}
          </span>
          {days > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>{days}d left</span>
            </>
          ) : null}
        </p>
        <span className="ng-ticket__cta">
          Back this show
          <span className="ms-icon" aria-hidden>arrow_forward</span>
        </span>
      </div>
    </Link>
  );
}

export function LiveEventRail({ campaigns }: { campaigns: Campaign[] }) {
  if (campaigns.length === 0) return null;
  return (
    <HomeShelf
      kicker="Real-time performance"
      kickerTone="tertiary"
      title="Upcoming Live Events"
      description="Fan-funded shows — pledges are held in escrow and refunded if the goal isn't met."
      action={{ href: "/shows", label: "Browse all" }}
      itemWidth={300}
      testId="live-event-rail"
    >
      {campaigns.slice(0, MAX_EVENTS).map((campaign) => (
        <TicketCard key={campaign.id} campaign={campaign} />
      ))}
    </HomeShelf>
  );
}
