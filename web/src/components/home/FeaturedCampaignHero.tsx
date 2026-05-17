"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import {
  Campaign,
  daysUntil,
  formatMoneyCompact,
  progressRatio,
} from "../../lib/shows";

interface FeaturedCampaignHeroProps {
  campaign: Campaign;
}

export function FeaturedCampaignHero({ campaign }: FeaturedCampaignHeroProps) {
  const ratio = progressRatio(campaign);
  const pct = Math.round(ratio * 100);
  const days = daysUntil(campaign.deadline);
  const raised = formatMoneyCompact(campaign.raisedCents, campaign.currency);
  const goal = formatMoneyCompact(campaign.goalCents, campaign.currency);
  const urgent = days <= 7;

  return (
    <div className="fch-root">
      {/* ── Ambient background ── */}
      {campaign.heroImage ? (
        <div
          className="fch-backdrop"
          style={{ backgroundImage: `url(${campaign.heroImage})` }}
        />
      ) : (
        <div className="fch-backdrop fch-backdrop--gradient" />
      )}
      <div className="fch-backdrop-overlay" />

      {/* ── SVG concentric wave rings ── */}
      <svg className="fch-rings" viewBox="0 0 800 800" aria-hidden focusable="false">
        <g fill="none" stroke="currentColor">
          <circle cx="400" cy="400" r="80"  strokeWidth="1" opacity="0.5" />
          <circle cx="400" cy="400" r="160" strokeWidth="1" opacity="0.35" />
          <circle cx="400" cy="400" r="250" strokeWidth="1" opacity="0.22" />
          <circle cx="400" cy="400" r="350" strokeWidth="1" opacity="0.13" />
          <circle cx="400" cy="400" r="460" strokeWidth="1" opacity="0.07" />
          <circle cx="400" cy="400" r="580" strokeWidth="1" opacity="0.04" />
        </g>
        <circle className="fch-rings__ping" cx="400" cy="400" r="80" fill="none" strokeWidth="1.5" stroke="currentColor" />
        <circle cx="400" cy="400" r="7" fill="currentColor" opacity="0.9" />
      </svg>

      {/* ── Layout ── */}
      <div className="fch-inner">

        {/* LEFT — content */}
        <div className="fch-content">
          {/* Badge row */}
          <div className="fch-badge-row">
            <span className="fch-badge">
              <span className="fch-badge__dot" />
              Featured Campaign
            </span>
            {campaign.status === "active" && (
              <span className="fch-status-chip">Active</span>
            )}
          </div>

          {/* Artist + location */}
          <h2 className="fch-artist">{campaign.artistName}</h2>
          <p className="fch-location">
            {campaign.city}
            {campaign.venue && <> · <span className="fch-venue">{campaign.venue}</span></>}
          </p>

          {/* Tagline */}
          <p className="fch-tagline">{campaign.tagline}</p>

          {/* Funding card */}
          <div className="fch-funding-card">
            <div className="fch-funding-top">
              <span className="fch-raised">
                <strong>{raised}</strong>
                <span className="fch-raised__label"> raised of {goal}</span>
              </span>
              <span className="fch-pct">{pct}%</span>
            </div>
            <div className="fch-bar-track">
              <div
                className="fch-bar-fill"
                style={{ "--fch-pct": `${pct}%` } as CSSProperties}
              />
            </div>

            {/* Social proof strip */}
            <div className="fch-social">
              <span className="fch-social__item">
                <span className="fch-avatars" aria-hidden>
                  {["B","S","M"].map((l) => (
                    <span key={l} className="fch-avatar">{l}</span>
                  ))}
                </span>
                <strong>{campaign.backerCount}</strong> backers
              </span>
              <span className="fch-divider" aria-hidden />
              <span className={`fch-social__item ${urgent ? "fch-social__item--urgent" : ""}`}>
                {urgent ? "🔥" : "⏳"} <strong>{days}</strong> days left
              </span>
              {campaign.venue && (
                <>
                  <span className="fch-divider" aria-hidden />
                  <span className="fch-social__item">{campaign.venue}</span>
                </>
              )}
            </div>
          </div>

          {/* CTAs */}
          <div className="fch-actions">
            <Link href={`/shows/${campaign.id}`} className="fch-btn fch-btn--primary">
              Back This Show
            </Link>
            <Link href={`/shows/${campaign.id}`} className="fch-btn fch-btn--glass">
              Listen Now
            </Link>
          </div>

          {/* Web3 trust badge */}
          <a
            href={campaign.etherscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="fch-trust"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            🔒 Funds locked in smart contract
            <span className="fch-trust__link">· View on Etherscan ↗</span>
          </a>
        </div>

        {/* RIGHT — ambient art panel */}
        <div className="fch-art-panel" aria-hidden>
          <div className="fch-art-orb" />
          <div className="fch-art-glow" />
          <svg className="fch-art-rings" viewBox="0 0 400 400">
            <g fill="none" stroke="currentColor" strokeWidth="1">
              <circle cx="200" cy="200" r="50"  opacity="0.6" />
              <circle cx="200" cy="200" r="100" opacity="0.4" />
              <circle cx="200" cy="200" r="155" opacity="0.25" />
              <circle cx="200" cy="200" r="195" opacity="0.12" />
            </g>
          </svg>
          <div className="fch-art-label">
            <span>{campaign.artistName}</span>
            <span>{campaign.city}</span>
          </div>
        </div>
      </div>

      <style jsx>{`
        /* ── Root ─────────────────────────────────────────────── */
        .fch-root {
          position: relative;
          width: 100%;
          min-height: 480px;
          border-radius: 28px;
          overflow: hidden;
          display: flex;
          align-items: stretch;
          margin-bottom: var(--ds-stack-lg, 48px);
          border: 1px solid rgba(138, 63, 252, 0.15);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.04) inset,
            0 40px 80px rgba(0,0,0,0.5),
            0 0 60px rgba(138,63,252,0.08);
          transition: box-shadow 0.4s ease, transform 0.4s ease;
        }
        .fch-root:hover {
          transform: translateY(-3px);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.06) inset,
            0 50px 100px rgba(0,0,0,0.6),
            0 0 80px rgba(138,63,252,0.15);
        }

        /* ── Backdrop ─────────────────────────────────────────── */
        .fch-backdrop {
          position: absolute;
          inset: -20px;
          background-size: cover;
          background-position: center;
          filter: blur(80px) saturate(140%) brightness(0.25);
          z-index: 0;
          transition: transform 1.2s ease;
        }
        .fch-root:hover .fch-backdrop { transform: scale(1.08); }
        .fch-backdrop--gradient {
          background: radial-gradient(ellipse at 70% 40%, rgba(138,63,252,0.55) 0%, rgba(21,18,28,0) 65%),
                      radial-gradient(ellipse at 20% 80%, rgba(255,183,130,0.2) 0%, rgba(21,18,28,0) 55%);
          filter: none;
        }
        .fch-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            105deg,
            rgba(21,18,28,0.96) 0%,
            rgba(21,18,28,0.80) 45%,
            rgba(21,18,28,0.35) 70%,
            rgba(21,18,28,0.10) 100%
          );
          z-index: 1;
        }

        /* ── Concentric rings ─────────────────────────────────── */
        .fch-rings {
          position: absolute;
          right: -60px;
          top: 50%;
          transform: translateY(-50%);
          width: 640px;
          height: 640px;
          color: rgba(138,63,252,0.18);
          z-index: 2;
          pointer-events: none;
        }
        .fch-rings__ping {
          animation: fch-ping 3.5s ease-out infinite;
          transform-origin: 400px 400px;
        }
        @keyframes fch-ping {
          0%   { opacity: 0.7; r: 80; }
          100% { opacity: 0;   r: 200; }
        }

        /* ── Inner layout ─────────────────────────────────────── */
        .fch-inner {
          position: relative;
          z-index: 10;
          display: flex;
          width: 100%;
          align-items: center;
          padding: 48px 56px;
          gap: 48px;
        }

        /* ── Content (left) ───────────────────────────────────── */
        .fch-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* Badge row */
        .fch-badge-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
        }
        .fch-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ds-primary, #d4bbff);
          background: rgba(138,63,252,0.12);
          border: 1px solid rgba(138,63,252,0.28);
          border-radius: 20px;
          padding: 5px 12px;
        }
        .fch-badge__dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #8a3ffc;
          box-shadow: 0 0 6px #8a3ffc;
          animation: fch-dot-pulse 2s ease-in-out infinite;
        }
        @keyframes fch-dot-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #8a3ffc; }
          50%       { opacity: 0.6; box-shadow: 0 0 14px #8a3ffc; }
        }
        .fch-status-chip {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #4ade80;
          background: rgba(74,222,128,0.1);
          border: 1px solid rgba(74,222,128,0.25);
          border-radius: 20px;
          padding: 4px 10px;
        }

        /* Artist + location */
        .fch-artist {
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
          font-size: clamp(52px, 6vw, 80px);
          font-weight: 800;
          line-height: 0.95;
          letter-spacing: -0.03em;
          color: #fff;
          margin: 0 0 10px;
        }
        .fch-location {
          font-size: 22px;
          font-weight: 600;
          color: var(--ds-tertiary, #ffb782);
          margin: 0 0 14px;
          letter-spacing: -0.01em;
        }
        .fch-venue {
          opacity: 0.85;
        }
        .fch-tagline {
          font-size: 14px;
          color: var(--ds-on-surface-variant, #cdc2d8);
          margin: 0 0 24px;
          max-width: 480px;
          line-height: 1.55;
        }

        /* Funding card */
        .fch-funding-card {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(20px) saturate(120%);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 20px 22px;
          margin-bottom: 24px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(138,63,252,0.07) inset;
        }
        .fch-funding-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }
        .fch-raised strong {
          font-size: 22px;
          font-weight: 800;
          color: #fff;
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
        }
        .fch-raised__label {
          font-size: 13px;
          color: var(--ds-on-surface-variant, #cdc2d8);
          margin-left: 6px;
        }
        .fch-pct {
          font-size: 18px;
          font-weight: 700;
          color: var(--ds-primary-container, #8a3ffc);
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
        }

        /* Progress bar */
        .fch-bar-track {
          height: 8px;
          background: rgba(255,255,255,0.08);
          border-radius: 99px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .fch-bar-fill {
          height: 100%;
          width: var(--fch-pct, 0%);
          border-radius: 99px;
          background: linear-gradient(90deg, #6b21fc 0%, #8a3ffc 60%, #b06aff 100%);
          box-shadow: 0 0 12px rgba(138,63,252,0.7);
          animation: fch-bar-in 1.1s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes fch-bar-in {
          from { width: 0%; }
          to   { width: var(--fch-pct, 0%); }
        }

        /* Social proof */
        .fch-social {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .fch-social__item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--ds-on-surface-variant, #cdc2d8);
        }
        .fch-social__item strong { color: #fff; }
        .fch-social__item--urgent { color: #f87171; }
        .fch-social__item--urgent strong { color: #fca5a5; }
        .fch-divider {
          width: 1px;
          height: 14px;
          background: rgba(255,255,255,0.15);
        }
        .fch-avatars {
          display: flex;
        }
        .fch-avatar {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8a3ffc, #55348c);
          border: 2px solid rgba(21,18,28,0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
          color: #fff;
          margin-left: -6px;
        }
        .fch-avatar:first-child { margin-left: 0; }

        /* CTAs */
        .fch-actions {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
        }
        .fch-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 50px;
          padding: 0 32px;
          border-radius: 99px;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.01em;
          text-decoration: none;
          transition: all 0.25s cubic-bezier(0.2,0.8,0.2,1);
          cursor: pointer;
        }
        .fch-btn--primary {
          background: #fff;
          color: #100c16;
          box-shadow: 0 8px 24px rgba(255,255,255,0.18);
        }
        .fch-btn--primary:hover {
          transform: translateY(-2px) scale(1.03);
          box-shadow: 0 12px 32px rgba(255,255,255,0.28);
          background: #f0e8ff;
        }
        .fch-btn--glass {
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.88);
          border: 1px solid rgba(255,255,255,0.14);
          backdrop-filter: blur(12px);
        }
        .fch-btn--glass:hover {
          background: rgba(255,255,255,0.12);
          border-color: rgba(255,255,255,0.24);
          transform: translateY(-2px);
        }

        /* Trust badge */
        .fch-trust {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          color: var(--ds-on-surface-variant, #cdc2d8);
          text-decoration: none;
          opacity: 0.75;
          transition: opacity 0.2s;
        }
        .fch-trust:hover { opacity: 1; }
        .fch-trust svg { flex-shrink: 0; color: #4ade80; }
        .fch-trust__link {
          color: var(--ds-primary, #d4bbff);
          margin-left: 2px;
        }

        /* ── Right art panel ──────────────────────────────────── */
        .fch-art-panel {
          flex-shrink: 0;
          width: clamp(200px, 28vw, 360px);
          aspect-ratio: 1/1;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 24px;
          overflow: hidden;
          background: rgba(138,63,252,0.06);
          border: 1px solid rgba(138,63,252,0.18);
          box-shadow: 0 0 60px rgba(138,63,252,0.12) inset;
        }
        .fch-art-orb {
          position: absolute;
          width: 55%;
          height: 55%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(138,63,252,0.8) 0%, rgba(85,52,140,0.5) 50%, transparent 75%);
          filter: blur(28px);
          animation: fch-orb-breathe 4s ease-in-out infinite;
        }
        @keyframes fch-orb-breathe {
          0%, 100% { transform: scale(1);    opacity: 0.7; }
          50%       { transform: scale(1.15); opacity: 1; }
        }
        .fch-art-glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 50% 60%, rgba(255,183,130,0.12) 0%, transparent 65%);
        }
        .fch-art-rings {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          color: rgba(138,63,252,0.35);
        }
        .fch-art-label {
          position: absolute;
          bottom: 18px;
          left: 0;
          right: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .fch-art-label span:first-child {
          font-size: 13px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
        }
        .fch-art-label span:last-child {
          font-size: 11px;
          color: var(--ds-tertiary, #ffb782);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        /* ── Responsive ───────────────────────────────────────── */
        @media (max-width: 1024px) {
          .fch-inner { padding: 36px 36px; gap: 32px; }
          .fch-art-panel { width: clamp(160px, 22vw, 260px); }
        }
        @media (max-width: 767px) {
          .fch-root { min-height: 0; border-radius: 20px; }
          .fch-inner {
            flex-direction: column-reverse;
            padding: 24px 20px;
            gap: 24px;
          }
          .fch-art-panel { width: 100%; max-width: 220px; margin: 0 auto; }
          .fch-artist { font-size: 42px; }
          .fch-location { font-size: 17px; }
          .fch-btn { height: 44px; padding: 0 22px; font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
