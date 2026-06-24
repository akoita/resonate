import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignHero } from "../../../components/shows/CampaignHero";
import { CampaignGallery } from "../../../components/shows/CampaignGallery";
import { CampaignCommunityPanel } from "../../../components/shows/CampaignCommunityPanel";
import { CampaignOperatorPanel } from "../../../components/shows/CampaignOperatorPanel";
import { PledgeIntentPanel } from "../../../components/shows/PledgeIntentPanel";
import { CampaignTrustPanel } from "../../../components/shows/CampaignTrustPanel";
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { campaignId } = await params;
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { title: "Show campaign" };
  }

  const title = campaignDisplayTitle(campaign);
  const description = campaign.tagline;
  const image = campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: image ? [{ url: image, alt: title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
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
  const galleryVisuals = campaign.visuals
    .filter((visual) => visual.role === "gallery")
    .slice(0, 6);
  const showExpandedPitch = displayTitle.length > 54 || campaign.tagline.length > 220;

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

        {galleryVisuals.length > 0 ? (
          <section aria-label="Campaign visuals">
            <div className="shows-home-section__header" style={{ marginBottom: 18 }}>
              <span className="shows-home-section__kicker">Gallery</span>
              <h2 className="shows-home-section__title">The campaign in pictures</h2>
            </div>
            <CampaignGallery visuals={galleryVisuals} />
          </section>
        ) : null}

        {showExpandedPitch ? (
          <section className="show-detail__pitch" aria-label="Campaign pitch">
            <span className="shows-home-section__kicker">Campaign pitch</span>
            <p>{campaign.tagline}</p>
          </section>
        ) : null}

        {campaign.artistSummary ? (
          <section className="show-detail__artist-story" aria-label={`About ${campaign.artistName}`}>
            {campaign.artistImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- artist media is supplied by the backend fixture manifest.
              <img src={campaign.artistImage} alt={campaign.artistName} />
            ) : null}
            <div>
              <span className="shows-home-section__kicker">Meet the artist</span>
              <h2 className="shows-home-section__title">{campaign.artistName}</h2>
              <p>{campaign.artistSummary}</p>
              {Object.keys(campaign.artistLinks).length > 0 ? (
                <nav className="show-detail__artist-links" aria-label={`${campaign.artistName} links`}>
                  {Object.entries(campaign.artistLinks).map(([label, url]) => (
                    <a key={label} href={url} target="_blank" rel="noreferrer noopener">
                      {label.replace(/(^|_)(\w)/g, (_match, _separator, letter: string) => ` ${letter.toUpperCase()}`).trim()} ↗
                    </a>
                  ))}
                </nav>
              ) : null}
            </div>
          </section>
        ) : null}

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
          <article className="show-detail__signal-card show-detail__signal-card--target">
            <span className="show-detail__signal-label">Show target</span>
            <strong title={campaign.venue ?? campaign.city}>{campaign.venue ?? campaign.city}</strong>
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

          <div className="show-detail__pledge-column">
            <CampaignTrustPanel campaign={campaign} />
            <PledgeIntentPanel campaign={campaign} fallbackTiers={tiers} />
          </div>
        </section>

        <CampaignCommunityPanel campaign={campaign} />

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
