"use client";

import { useState, useEffect } from "react";
import {
  formatEth,
  parseDateToEpochSeconds,
  deriveStakeStatus,
  deriveEscrowStatus,
  STAKE_STATUS_LABELS,
  STAKE_STATUS_COLORS,
  ESCROW_STATUS_LABELS,
  TIER_LABELS,
  TIER_COLORS,
  type StakeStatus,
} from "../../lib/stakeConstants";

interface ReleaseProtectionData {
  tokenId?: string | null;
  staked: boolean;
  attested: boolean;
  stakeAmount: string;
  depositedAt: string;
  active: boolean;
  escrowDays: number;
  trustTier: string;
  attestedAt: string;
}

interface ReleaseContentProtectionProps {
  /** Release ID to look up content protection status via backend. */
  releaseId: string;
}

/**
 * Content Protection section for the release detail page.
 *
 * Fetches protection status from the backend indexer.
 * Falls back gracefully if the endpoint is not available.
 */
export default function ReleaseContentProtection({ releaseId }: ReleaseContentProtectionProps) {
  const [data, setData] = useState<ReleaseProtectionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/metadata/content-protection/release/${releaseId}`)
      .then(r => {
        if (!r.ok) throw new Error("Not available");
        return r.json();
      })
      .then((d: ReleaseProtectionData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        // Endpoint not available — show informational fallback
        setData(null);
        setLoading(false);
      });
  }, [releaseId]);

  if (loading) {
    return (
      <section style={sectionStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: "18px" }}>🛡️</span>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Content Protection</h3>
            <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>Loading…</p>
          </div>
        </div>
      </section>
    );
  }

  // No live data from backend — show Content Protection program defaults.
  // Staking is atomic with publishing, so any published release is covered.
  if (!data) {
    return (
      <section style={sectionStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: "18px" }}>🛡️</span>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Content Protection</h3>
            <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>
              Staked at publish — protecting against copyright violations
            </p>
          </div>
        </div>

        <div style={gridStyle}>
          <div style={statStyle}>
            <span style={statLabelStyle}>Trust Tier</span>
            <span style={{ fontWeight: 600, fontSize: "15px", color: TIER_COLORS["new"] }}>
              {TIER_LABELS["new"]}
            </span>
          </div>
          <div style={statStyle}>
            <span style={statLabelStyle}>Stake Required</span>
            <span style={{ fontWeight: 600, fontSize: "15px" }}>0.01 ETH</span>
          </div>
          <div style={statStyle}>
            <span style={statLabelStyle}>Escrow Period</span>
            <span style={{ fontWeight: 500, fontSize: "15px" }}>30 days</span>
          </div>
        </div>

        <div style={{
          marginTop: "12px",
          padding: "10px 14px",
          background: "rgba(245, 158, 11, 0.06)",
          borderRadius: "10px",
          fontSize: "12px",
          opacity: 0.7,
        }}>
          A refundable stake of <strong>0.01 ETH</strong> was deposited on publish.
          Revenue is held in escrow for 30 days. As creators build clean history, their stake decreases.
        </div>
      </section>
    );
  }

  // Derive status from data
  const depositedEpoch = parseDateToEpochSeconds(data.depositedAt);
  const hasDepositedAt = depositedEpoch > 0n;
  const stakeStatus: StakeStatus = data.staked
    ? hasDepositedAt
      ? deriveStakeStatus(data.active, BigInt(data.stakeAmount), depositedEpoch, data.escrowDays)
      : data.active
        ? "active"
        : "refunded"
    : "not_staked";
  const escrow = data.staked
    ? hasDepositedAt
      ? deriveEscrowStatus(data.active, depositedEpoch, data.escrowDays)
      : { status: data.active ? "locked" as const : "released" as const, daysRemaining: 0 }
    : { status: "none" as const, daysRemaining: 0 };

  const tierLabel = TIER_LABELS[data.trustTier] || data.trustTier;
  const tierColor = TIER_COLORS[data.trustTier] || "#888";

  return (
    <section style={sectionStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: "18px" }}>🛡️</span>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Content Protection</h3>
          <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>
            Stake-to-publish protection for this release
          </p>
        </div>
        {/* Status pill */}
        <div style={{
          marginLeft: "auto",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 12px",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${STAKE_STATUS_COLORS[stakeStatus]}33`,
          borderRadius: "20px",
          fontSize: "12px",
          fontWeight: 600,
          color: STAKE_STATUS_COLORS[stakeStatus],
        }}>
          {STAKE_STATUS_LABELS[stakeStatus]}
        </div>
      </div>

      <div style={gridStyle}>
        {/* Stake Amount */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Stake</span>
          <span style={{ fontWeight: 600, fontSize: "15px" }}>
            {data.staked ? formatEth(data.stakeAmount) : "—"}
          </span>
        </div>

        {/* Trust Tier */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Trust Tier</span>
          <span style={{ fontWeight: 600, fontSize: "15px", color: tierColor }}>
            {tierLabel}
          </span>
        </div>

        {/* Escrow */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Escrow</span>
          <span style={{ fontWeight: 500, fontSize: "15px" }}>
            {ESCROW_STATUS_LABELS[escrow.status]}
            {escrow.daysRemaining > 0 && (
              <span style={{ opacity: 0.5, fontSize: "12px", marginLeft: "4px" }}>
                ({escrow.daysRemaining}d)
              </span>
            )}
          </span>
        </div>

        {/* Attestation */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Attestation</span>
          <span style={{ fontWeight: 500, fontSize: "15px", color: data.attested ? "#10b981" : "#6b7280" }}>
            {data.attested ? "✓ Verified" : "—"}
          </span>
        </div>
      </div>
    </section>
  );
}

// ---- Styles ----

const sectionStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "24px",
  padding: "24px",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "20px",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "16px",
};

const statStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "12px 16px",
  background: "rgba(255,255,255,0.03)",
  borderRadius: "12px",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 500,
  opacity: 0.5,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};
