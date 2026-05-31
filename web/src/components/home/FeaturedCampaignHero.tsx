"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import {
  Campaign,
  campaignDisplayInitial,
  campaignDisplayTitle,
  daysUntil,
  formatMoneyCompact,
  progressRatio,
} from "../../lib/shows";

interface FeaturedCampaignHeroProps { campaign: Campaign; }

export function FeaturedCampaignHero({ campaign }: FeaturedCampaignHeroProps) {
  const ratio = progressRatio(campaign);
  const pct = Math.round(ratio * 100);
  const days = daysUntil(campaign.deadline);
  const raised = formatMoneyCompact(campaign.raisedCents, campaign.currency);
  const goal = formatMoneyCompact(campaign.goalCents, campaign.currency);
  const urgent = days <= 7;
  const displayTitle = campaignDisplayTitle(campaign);
  const initial = campaignDisplayInitial(campaign);
  // Derive a hue from the initial letter for per-artist colour variety
  const hue = (initial.charCodeAt(0) * 47) % 360;

  return (
    <div className="fch-root">
      {/* ── Ambient blurred backdrop ── */}
      <div
        className={`fch-backdrop ${campaign.heroImage ? "fch-backdrop--image" : ""}`}
        style={{
          "--fch-hue": hue,
          ...(campaign.heroImage ? { "--fch-image": `url(${campaign.heroImage})` } : {}),
        } as CSSProperties}
      />

      {/* ── Left content column ── */}
      <div className="fch-left">
        {/* Eyebrow */}
        <div className="fch-eyebrow">
          <span className="fch-pulse" />
          <span>Featured Campaign</span>
          {campaign.status === "active" && <span className="fch-live-chip">Live</span>}
        </div>

        {/* Big name */}
        <h2 className="fch-name">{displayTitle}</h2>

        {/* Location line */}
        <p className="fch-where">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
          {campaign.city}{campaign.venue && <> · <em>{campaign.venue}</em></>}
        </p>

        {/* Tagline */}
        <p className="fch-tagline">{campaign.tagline}</p>

        {/* ── Funding glass card ── */}
        <div className="fch-card">
          <div className="fch-card-top">
            <div>
              <span className="fch-amount">{raised}</span>
              <span className="fch-of"> of {goal}</span>
            </div>
            <span className="fch-pct">{pct}%</span>
          </div>

          {/* Progress track */}
          <div className="fch-track">
            <div className="fch-fill" style={{ "--p": `${pct}%` } as CSSProperties} />
            {/* Milestone marker at threshold */}
            {campaign.thresholdBackers > 0 && (
              <div
                className="fch-marker"
                style={{ left: `${Math.min(100, Math.round((campaign.backerCount / (campaign.thresholdBackers || 1)) * 100))}%` }}
                title={`Threshold: ${campaign.thresholdBackers} backers`}
              />
            )}
          </div>

          {/* Stats row */}
          <div className="fch-stats">
            <span className="fch-stat">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
              <strong>{campaign.backerCount}</strong> backers
            </span>
            <span className="fch-sep" aria-hidden />
            <span className={`fch-stat ${urgent ? "fch-stat--urgent" : ""}`}>
              {urgent ? "🔥" : "⏳"} <strong>{days}</strong> days left
            </span>
            {campaign.thresholdBackers > 0 && (
              <>
                <span className="fch-sep" aria-hidden />
                <span className="fch-stat">threshold <strong>{campaign.thresholdBackers}</strong></span>
              </>
            )}
          </div>
        </div>

        {/* ── CTAs ── */}
        <div className="fch-actions">
          <Link href={`/shows/${campaign.id}`} className="fch-btn fch-btn--primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
            Back This Show
          </Link>
          <Link href={`/shows/${campaign.id}`} className="fch-btn fch-btn--ghost">
            Listen Now
          </Link>
        </div>

        {/* Web3 trust */}
        <a href={campaign.etherscanUrl} target="_blank" rel="noopener noreferrer" className="fch-trust">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Funds locked in smart contract · View on Etherscan ↗
        </a>
      </div>

      {/* ── Right art column ── */}
      <div className="fch-right" aria-hidden>
        {/* Gradient sphere */}
        <div className="fch-sphere" style={{ "--fch-hue": hue } as CSSProperties}>
          {/* Vinyl disc */}
          <div className="fch-disc">
            <div className="fch-disc-grooves" />
            <div className="fch-disc-label">
              <span className="fch-disc-initial">{initial}</span>
            </div>
            <div className="fch-disc-shine" />
          </div>
          {/* Concentric rings */}
          <svg className="fch-sphere-rings" viewBox="0 0 400 400">
            <g fill="none" stroke="currentColor">
              <circle cx="200" cy="200" r="60"  strokeWidth="1" opacity="0.5"/>
              <circle cx="200" cy="200" r="100" strokeWidth="1" opacity="0.32"/>
              <circle cx="200" cy="200" r="145" strokeWidth="1" opacity="0.18"/>
              <circle cx="200" cy="200" r="190" strokeWidth="1" opacity="0.09"/>
            </g>
          </svg>
        </div>

        {/* Floating particles */}
        {[0,1,2,3,4,5,6,7].map(i => (
          <div key={i} className="fch-particle" style={{ "--i": i } as CSSProperties} />
        ))}

        {/* Artist label */}
        <div className="fch-art-label">
          <span className="fch-art-name">{displayTitle}</span>
          <span className="fch-art-city">{campaign.city?.toUpperCase()}</span>
        </div>

        {/* Waveform bars */}
        <div className="fch-wave">
          {Array.from({ length: 28 }, (_, i) => (
            <div key={i} className="fch-wave-bar" style={{ "--j": i } as CSSProperties} />
          ))}
        </div>
      </div>

      <style jsx>{`
        /* ── Root ──────────────────────────────────────── */
        .fch-root {
          position: relative;
          width: 100%;
          min-height: 500px;
          border-radius: 28px;
          overflow: hidden;
          display: grid;
          grid-template-columns: 55% 45%;
          margin-bottom: 40px;
          border: 1px solid rgba(255,255,255,0.07);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.03) inset, 0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(124,58,237,0.1);
        }

        /* ── Backdrop ─────────────────────────────────── */
        .fch-backdrop {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 100% at 75% 50%,
              hsl(var(--fch-hue,265),70%,22%) 0%,
              hsl(var(--fch-hue,265),60%,10%) 45%,
              #0a0810 100%),
            radial-gradient(ellipse 60% 80% at 20% 70%, rgba(255,183,80,0.08) 0%, transparent 60%);
          z-index: 0;
        }
        .fch-backdrop--image {
          background:
            linear-gradient(90deg, rgba(10,8,16,0.98) 0%, rgba(10,8,16,0.78) 46%, rgba(10,8,16,0.36) 100%),
            radial-gradient(ellipse 60% 80% at 20% 70%, rgba(255,183,80,0.08) 0%, transparent 60%),
            var(--fch-image);
          background-position: center;
          background-size: cover;
        }

        /* ── Left column ──────────────────────────────── */
        .fch-left {
          position: relative;
          z-index: 10;
          padding: 52px 56px;
          display: flex;
          flex-direction: column;
          gap: 0;
          background: linear-gradient(105deg, rgba(10,8,16,0.97) 0%, rgba(10,8,16,0.85) 70%, transparent 100%);
        }

        /* Eyebrow */
        .fch-eyebrow {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 18px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(196,181,253,0.75);
        }
        .fch-pulse {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #8b5cf6;
          box-shadow: 0 0 8px #8b5cf6;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%,100% { opacity:1; box-shadow:0 0 8px #8b5cf6; }
          50%      { opacity:.5; box-shadow:0 0 16px #a78bfa; }
        }
        .fch-live-chip {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.14em;
          color: #4ade80;
          background: rgba(74,222,128,0.1);
          border: 1px solid rgba(74,222,128,0.28);
          border-radius: 20px;
          padding: 3px 9px;
        }

        /* Name */
        .fch-name {
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
          font-size: clamp(44px, 5.5vw, 76px);
          font-weight: 800;
          line-height: 0.95;
          letter-spacing: -0.035em;
          color: #fff;
          margin: 0 0 12px;
        }

        /* Where */
        .fch-where {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 17px;
          font-weight: 600;
          color: #fbbf24;
          margin: 0 0 10px;
          letter-spacing: -0.01em;
        }
        .fch-where em { font-style: normal; opacity: 0.75; }
        .fch-where svg { opacity: 0.7; flex-shrink: 0; }

        /* Tagline */
        .fch-tagline {
          font-size: 13.5px;
          line-height: 1.6;
          color: rgba(205,194,220,0.8);
          margin: 0 0 26px;
          max-width: 400px;
        }

        /* ── Funding card ─────────────────────────────── */
        .fch-card {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          padding: 20px 22px;
          margin-bottom: 26px;
          box-shadow: 0 4px 28px rgba(0,0,0,0.35), 0 0 0 1px rgba(139,92,246,0.08) inset;
        }
        .fch-card-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }
        .fch-amount {
          font-size: 24px;
          font-weight: 800;
          color: #fff;
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
        }
        .fch-of { font-size: 13px; color: rgba(205,194,220,0.7); margin-left: 6px; }
        .fch-pct {
          font-size: 20px;
          font-weight: 700;
          color: #a78bfa;
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
        }

        /* Progress */
        .fch-track {
          position: relative;
          height: 7px;
          background: rgba(255,255,255,0.07);
          border-radius: 99px;
          overflow: visible;
          margin-bottom: 14px;
        }
        .fch-fill {
          height: 100%;
          width: var(--p, 0%);
          border-radius: 99px;
          background: linear-gradient(90deg, #6d28d9, #8b5cf6 60%, #c4b5fd);
          box-shadow: 0 0 14px rgba(139,92,246,0.75);
          animation: barIn 1.2s cubic-bezier(0.22,1,0.36,1) both;
        }
        @keyframes barIn { from { width:0% } to { width:var(--p,0%) } }
        .fch-marker {
          position: absolute;
          top: -4px;
          width: 2px;
          height: 15px;
          background: rgba(251,191,36,0.8);
          border-radius: 2px;
          box-shadow: 0 0 8px rgba(251,191,36,0.5);
        }

        /* Stats */
        .fch-stats {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .fch-stat {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12.5px;
          color: rgba(205,194,220,0.75);
        }
        .fch-stat strong { color: #fff; }
        .fch-stat--urgent { color: #f87171; }
        .fch-stat--urgent strong { color: #fca5a5; }
        .fch-stat svg { opacity: 0.5; }
        .fch-sep {
          width: 1px; height: 12px;
          background: rgba(255,255,255,0.12);
        }

        /* CTAs */
        .fch-actions {
          display: flex;
          gap: 10px;
          margin-bottom: 18px;
        }
        .fch-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 50px;
          padding: 0 28px;
          border-radius: 99px;
          font-size: 14px;
          font-weight: 700;
          text-decoration: none;
          transition: all 0.22s cubic-bezier(0.2,0.8,0.2,1);
          letter-spacing: 0.01em;
          cursor: pointer;
        }
        .fch-btn--primary {
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          color: #fff;
          box-shadow: 0 8px 28px rgba(124,58,237,0.45), 0 0 0 1px rgba(255,255,255,0.12) inset;
        }
        .fch-btn--primary:hover {
          transform: translateY(-2px) scale(1.03);
          box-shadow: 0 12px 36px rgba(124,58,237,0.6), 0 0 0 1px rgba(255,255,255,0.18) inset;
        }
        .fch-btn--ghost {
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.85);
          border: 1px solid rgba(255,255,255,0.13);
          backdrop-filter: blur(12px);
        }
        .fch-btn--ghost:hover {
          background: rgba(255,255,255,0.11);
          border-color: rgba(255,255,255,0.22);
          transform: translateY(-2px);
        }

        /* Trust */
        .fch-trust {
          font-size: 11.5px;
          color: rgba(205,194,220,0.5);
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: color 0.2s;
        }
        .fch-trust:hover { color: rgba(196,181,253,0.85); }
        .fch-trust svg { color: #4ade80; flex-shrink: 0; }

        /* ── Right art column ─────────────────────────── */
        .fch-right {
          position: relative;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        /* Sphere */
        .fch-sphere {
          position: relative;
          width: clamp(220px, 24vw, 320px);
          height: clamp(220px, 24vw, 320px);
          flex-shrink: 0;
        }
        .fch-sphere::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%,
            hsl(calc(var(--fch-hue,265) + 20),80%,65%) 0%,
            hsl(var(--fch-hue,265),70%,35%) 45%,
            hsl(calc(var(--fch-hue,265) - 20),80%,12%) 100%);
          box-shadow:
            0 0 60px hsl(var(--fch-hue,265),70%,35%),
            0 0 120px hsl(var(--fch-hue,265),60%,20%) inset;
          animation: sphereBreathe 5s ease-in-out infinite;
        }
        @keyframes sphereBreathe {
          0%,100% { transform: scale(1);    box-shadow: 0 0 60px hsl(var(--fch-hue,265),70%,35%), 0 0 120px hsl(var(--fch-hue,265),60%,20%) inset; }
          50%      { transform: scale(1.04); box-shadow: 0 0 90px hsl(var(--fch-hue,265),80%,45%), 0 0 160px hsl(var(--fch-hue,265),60%,25%) inset; }
        }

        /* Rings on sphere */
        .fch-sphere-rings {
          position: absolute;
          inset: -25%;
          width: 150%; height: 150%;
          color: rgba(255,255,255,0.18);
          animation: ringsSpin 30s linear infinite;
        }
        @keyframes ringsSpin { to { transform: rotate(360deg); } }

        /* Vinyl disc */
        .fch-disc {
          position: absolute;
          width: 58%;
          height: 58%;
          border-radius: 50%;
          background: #0a0810;
          border: 2px solid rgba(255,255,255,0.06);
          top: 50%; left: 50%;
          transform: translate(-50%,-50%) perspective(600px) rotateX(22deg) rotateZ(-15deg);
          animation: discFloat 6s ease-in-out infinite;
          box-shadow: 0 20px 50px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset;
          overflow: hidden;
          z-index: 2;
        }
        @keyframes discFloat {
          0%,100% { transform: translate(-50%,-50%) perspective(600px) rotateX(22deg) rotateZ(-15deg) translateY(0); }
          50%      { transform: translate(-50%,-50%) perspective(600px) rotateX(22deg) rotateZ(-15deg) translateY(-10px); }
        }
        .fch-disc-grooves {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: repeating-radial-gradient(circle at 50% 50%,
            transparent 0px, transparent 5px,
            rgba(255,255,255,0.03) 5px, rgba(255,255,255,0.03) 6px);
        }
        .fch-disc-label {
          position: absolute;
          width: 38%; height: 38%;
          border-radius: 50%;
          background: radial-gradient(circle, #1e1430 0%, #0f0b1a 100%);
          border: 1px solid rgba(139,92,246,0.3);
          top: 50%; left: 50%;
          transform: translate(-50%,-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 20px rgba(139,92,246,0.4) inset;
        }
        .fch-disc-initial {
          font-size: clamp(16px, 2.5vw, 26px);
          font-weight: 800;
          color: #c4b5fd;
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
          letter-spacing: -0.05em;
        }
        .fch-disc-shine {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 55%);
        }

        /* Floating particles */
        .fch-particle {
          position: absolute;
          width: calc(3px + (var(--i,0) % 3) * 2px);
          height: calc(3px + (var(--i,0) % 3) * 2px);
          border-radius: 50%;
          background: hsl(calc(265 + var(--i,0) * 20), 80%, 75%);
          opacity: 0;
          top: calc(15% + var(--i,0) * 9%);
          right: calc(5% + (var(--i,0) % 4) * 8%);
          animation: particleDrift calc(4s + var(--i,0) * 0.7s) ease-in-out calc(var(--i,0) * 0.5s) infinite;
          box-shadow: 0 0 6px currentColor;
        }
        @keyframes particleDrift {
          0%   { opacity:0;   transform: translate(0,0) scale(0.5); }
          30%  { opacity:0.9; }
          100% { opacity:0;   transform: translate(calc(-20px - var(--i,0)*8px), calc(-40px - var(--i,0)*6px)) scale(1.5); }
        }

        /* Art label */
        .fch-art-label {
          position: absolute;
          bottom: 32px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          pointer-events: none;
        }
        .fch-art-name {
          font-size: 13px;
          font-weight: 700;
          color: rgba(255,255,255,0.8);
          font-family: var(--ds-font-display, "Space Grotesk", system-ui);
          white-space: nowrap;
        }
        .fch-art-city {
          font-size: 10px;
          letter-spacing: 0.16em;
          color: #fbbf24;
          opacity: 0.75;
        }

        /* Waveform */
        .fch-wave {
          position: absolute;
          bottom: 64px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: flex-end;
          gap: 3px;
          height: 24px;
          opacity: 0.35;
        }
        .fch-wave-bar {
          width: 3px;
          border-radius: 3px;
          background: rgba(196,181,253,0.8);
          height: calc(4px + (sin(var(--j,0) * 0.7 + 1) * 0.5 + 0.5) * 20px);
          animation: waveDance calc(1.4s + var(--j,0) * 0.08s) ease-in-out calc(var(--j,0) * 0.06s) infinite alternate;
        }
        @keyframes waveDance {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1); }
        }

        /* ── Responsive ───────────────────────────────── */
        @media (max-width: 900px) {
          .fch-root { grid-template-columns: 1fr; min-height: 0; }
          .fch-right { min-height: 240px; }
          .fch-left { padding: 36px 28px; }
        }
        @media (max-width: 600px) {
          .fch-name { font-size: 40px; }
          .fch-left { padding: 28px 20px; }
          .fch-btn { height: 44px; padding: 0 20px; font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
