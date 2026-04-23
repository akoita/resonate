"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { CampaignHero } from "../../../components/shows/CampaignHero";
import { getCampaignSync } from "../../../lib/shows";

interface Props {
  params: Promise<{ campaignId: string }>;
}

export default function CampaignDetailPage({ params }: Props) {
  const { campaignId } = use(params);
  const campaign = getCampaignSync(campaignId);
  if (!campaign) {
    notFound();
  }

  return (
    <main className="shows-surface shows-page">
      <div className="show-detail">
        <CampaignHero campaign={campaign} />

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
          <h3 className="show-detail__notice-title">
            Pledging launches with the cohort demo
          </h3>
          <p className="show-detail__notice-body">
            The pledge flow (wallet connect → tier → sign → receipt) ships
            with the a16z Speedrun cohort demo day. Until then, the campaign
            is live as an honest preview — the contract is deployed, the
            rules are public, the threshold is real. Follow{" "}
            <a
              href="https://x.com/aboobakar"
              target="_blank"
              rel="noreferrer noopener"
            >
              @aboobakar
            </a>{" "}
            for the launch.
          </p>
        </section>
      </div>
    </main>
  );
}
