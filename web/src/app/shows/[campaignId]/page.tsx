import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignHero } from "../../../components/shows/CampaignHero";
import { CampaignOperatorPanel } from "../../../components/shows/CampaignOperatorPanel";
import { PledgeIntentPanel } from "../../../components/shows/PledgeIntentPanel";
import {
  daysUntil,
  campaignDisplayTitle,
  formatMoney,
  getCampaign,
  progressRatio,
  type CampaignTier,
} from "../../../lib/shows";

interface Props {
  params: Promise<{ campaignId: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { campaignId } = await params;
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    notFound();
  }

  const daysLeft = Math.max(0, daysUntil(campaign.deadline));
  const displayTitle = campaignDisplayTitle(campaign);
  const progressPct = Math.round(progressRatio(campaign) * 100);
  const remainingCents = Math.max(0, campaign.goalCents - campaign.raisedCents);
  const backersNeeded = Math.max(0, campaign.thresholdBackers - campaign.backerCount);
  const targetDate = new Date(campaign.targetDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const deadline = new Date(campaign.deadline).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const tiers = campaign.tiers.length > 0
    ? campaign.tiers
    : defaultTiers(campaign.currency);

  return (
    <main className="shows-surface shows-page">
      <div className="show-detail">
        <nav className="show-detail__breadcrumb" aria-label="Breadcrumb">
          <Link href="/shows">Shows</Link>
          <span aria-hidden>/</span>
          <span>{displayTitle}</span>
        </nav>

        <CampaignHero campaign={campaign} />
        <CampaignOperatorPanel campaign={campaign} />

        <section className="show-detail__snapshot" aria-label="Campaign snapshot">
          <article className="show-detail__signal-card show-detail__signal-card--primary">
            <span className="show-detail__signal-label">Campaign signal</span>
            <strong>{progressPct}% funded</strong>
            <p>
              {formatMoney(remainingCents, campaign.currency)} still needed before
              the escrow can trigger a serious booking conversation.
            </p>
          </article>
          <article className="show-detail__signal-card">
            <span className="show-detail__signal-label">Fans needed</span>
            <strong>{backersNeeded.toLocaleString("en-US")}</strong>
            <p>
              {campaign.backerCount.toLocaleString("en-US")} fans have already
              joined the signal.
            </p>
          </article>
          <article className="show-detail__signal-card">
            <span className="show-detail__signal-label">Deadline</span>
            <strong>{daysLeft}d left</strong>
            <p>Campaign closes on {deadline}. If it misses, pledges refund automatically.</p>
          </article>
          <article className="show-detail__signal-card">
            <span className="show-detail__signal-label">Show target</span>
            <strong>{campaign.venue ?? campaign.city}</strong>
            <p>{targetDate}. Venue and production stay conditional until the threshold clears.</p>
          </article>
        </section>

        <section className="show-detail__brief-grid">
          <article className="show-detail__brief">
            <span className="shows-home-section__kicker">Why this matters</span>
            <h2 className="shows-home-section__title">A booking signal with weight.</h2>
            <p>
              This campaign turns fan demand into a measurable escrow signal.
              Instead of likes, comments, or vague interest, promoters see
              committed money, backer count, deadline, and refund rules up front.
            </p>
            <div className="show-detail__brief-points">
              <span>Verifiable demand</span>
              <span>Refund-first escrow</span>
              <span>Public contract trail</span>
            </div>
          </article>

          <PledgeIntentPanel campaign={campaign} fallbackTiers={tiers} />
        </section>

        <section>
          <div className="shows-home-section__header" style={{ marginBottom: 20 }}>
            <span className="shows-home-section__kicker">How it works</span>
            <h2 className="shows-home-section__title">
              Three steps. Enforced by code.
            </h2>
          </div>
          <div className="show-detail__how">
            <article className="show-detail__step">
              <span className="show-detail__step-num">Step 1 — Pledge</span>
              <h3 className="show-detail__step-title">You lock funds in escrow</h3>
              <p className="show-detail__step-body">
                You pick a tier and pledge. The money goes into a smart
                contract on Sepolia — not a company&apos;s bank account.
              </p>
            </article>
            <article className="show-detail__step">
              <span className="show-detail__step-num">Step 2 — Threshold</span>
              <h3 className="show-detail__step-title">Enough fans commit</h3>
              <p className="show-detail__step-body">
                If the funding threshold is met before the deadline, the
                artist&apos;s team gets a verifiable demand signal and reviews
                the booking.
              </p>
            </article>
            <article className="show-detail__step">
              <span className="show-detail__step-num">Step 3 — Confirm or refund</span>
              <h3 className="show-detail__step-title">Code decides the outcome</h3>
              <p className="show-detail__step-body">
                If the artist confirms, funds release to production and fans
                get tickets plus a Soulbound Token. If not, the contract
                refunds every pledge automatically.
              </p>
            </article>
          </div>
        </section>

        <section className="show-detail__notice" aria-live="polite">
          <div>
            <h3 className="show-detail__notice-title">
              Pledging follows the live escrow
            </h3>
            <p className="show-detail__notice-body">
              Escrow-backed campaigns let fans select a tier, sign the ERC-20
              approval plus pledge through their smart account, and attach the
              mined transaction to a Resonate receipt. Demo-only campaigns stay
              receipt-preview until their escrow deployment is linked.
            </p>
          </div>
          <a
            href="https://x.com/aboobakar"
            target="_blank"
            rel="noreferrer noopener"
            className="show-detail__notice-link"
          >
            Follow launch updates ↗
          </a>
        </section>
      </div>
    </main>
  );
}

function defaultTiers(currency: "EUR" | "USD"): CampaignTier[] {
  return [
    {
      id: "fan-signal",
      title: "Fan signal",
      amountCents: 2_500,
      currency,
      paymentAssetSymbol: "USDC",
      description: "Refundable support signal and campaign receipt.",
    },
    {
      id: "ticket-intent",
      title: "Ticket intent",
      amountCents: 7_500,
      currency,
      paymentAssetSymbol: "USDC",
      description: "Priority allocation if the show is booked.",
    },
    {
      id: "patron-circle",
      title: "Patron circle",
      amountCents: 25_000,
      currency,
      paymentAssetSymbol: "USDC",
      description: "Premium campaign receipt and patron allocation.",
    },
  ];
}
