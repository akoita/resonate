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
  economicTrustTier?: string;
  humanVerificationStatus?: string;
  humanVerifiedAt?: string | null;
  platformReviewStatus?: string;
  attestedAt: string;
  provenanceStatus?: string;
  rightsVerificationStatus?: string;
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

  const economicTier = data.economicTrustTier || data.trustTier;
  const isSelfAttested =
    data.provenanceStatus === "self_attested" ||
    (data.provenanceStatus == null && data.attested);
  const tierLabel = TIER_LABELS[economicTier] || economicTier;
  const tierColor = TIER_COLORS[economicTier] || "#888";
  const humanVerificationLabel =
    data.humanVerificationStatus === "human_verified"
      ? "Human Verified"
      : "Not Human Verified";
  const humanVerificationColor =
    data.humanVerificationStatus === "human_verified" ? "#10b981" : "#6b7280";
  const provenanceLabel = isSelfAttested
      ? "Self-attested on-chain"
      : data.provenanceStatus === "fingerprint_cleared"
        ? "Fingerprint cleared"
        : "Not attested";
  const rightsReviewLabel =
    data.rightsVerificationStatus === "platform_review_pending"
      ? "Review pending"
      : data.rightsVerificationStatus === "platform_reviewed"
        ? "Platform reviewed"
        : data.rightsVerificationStatus === "rights_verified"
          ? "Rights verified"
          : data.rightsVerificationStatus === "rights_disputed"
            ? "Rights disputed"
            : "Not independently reviewed";

  return (
    <section style={sectionStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: "18px" }}>🛡️</span>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Content Protection</h3>
          <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>
            Economic trust, human verification, provenance, and release review signals for this release
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
            {data.stakeAmount ? formatEth(data.stakeAmount) : "—"}
          </span>
        </div>

        {/* Trust Tier */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Economic Trust</span>
          <span style={{ fontWeight: 600, fontSize: "15px", color: tierColor }}>
            {tierLabel}
          </span>
        </div>

        <div style={statStyle}>
          <span style={statLabelStyle}>Human Verification</span>
          <span
            style={{
              fontWeight: 500,
              fontSize: "15px",
              color: humanVerificationColor,
            }}
          >
            {humanVerificationLabel}
          </span>
        </div>

        {/* Escrow */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Escrow</span>
          <span style={{ fontWeight: 500, fontSize: "15px" }}>
            {data.staked ? (
              <>
                {ESCROW_STATUS_LABELS[escrow.status]}
                {escrow.daysRemaining > 0 && (
                  <span style={{ opacity: 0.5, fontSize: "12px", marginLeft: "4px" }}>
                    ({escrow.daysRemaining}d)
                  </span>
                )}
              </>
            ) : (
              <>
                {data.escrowDays}d policy
              </>
            )}
          </span>
        </div>

        {/* Provenance */}
        <div style={statStyle}>
          <span style={statLabelStyle}>Provenance</span>
          <span
            style={{
              fontWeight: 500,
              fontSize: "15px",
              color: isSelfAttested ? "#10b981" : "#6b7280",
            }}
          >
            {provenanceLabel}
          </span>
        </div>

        <div style={statStyle}>
          <span style={statLabelStyle}>Rights Review</span>
          <span
            style={{
              fontWeight: 500,
              fontSize: "15px",
              color:
                data.rightsVerificationStatus === "rights_disputed"
                  ? "#ef4444"
                  : data.rightsVerificationStatus === "platform_review_pending"
                    ? "#f59e0b"
                    : "#6b7280",
            }}
          >
            {rightsReviewLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          marginTop: "12px",
          padding: "10px 14px",
          background: "rgba(255,255,255,0.03)",
          borderRadius: "10px",
          fontSize: "12px",
          opacity: 0.72,
        }}
      >
        Economic trust tier, human verification, provenance, and release rights review are tracked separately. Human verification confirms the creator wallet passed a personhood check; it does not, by itself, mean the platform independently verified ownership rights.
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
