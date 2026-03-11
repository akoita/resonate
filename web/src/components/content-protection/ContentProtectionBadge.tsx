"use client";

import { useState, useEffect } from "react";
import { useStakeInfo, useAttestationInfo } from "../../hooks/useContracts";
import {
  formatEth,
  deriveStakeStatus,
  deriveEscrowStatus,
  STAKE_STATUS_LABELS,
  STAKE_STATUS_COLORS,
  ESCROW_STATUS_LABELS,
  TIER_LABELS,
  TIER_COLORS,
} from "../../lib/stakeConstants";

interface ContentProtectionBadgeProps {
  /** The on-chain tokenId to look up stake / attestation for. */
  tokenId: bigint;
  /** Optional canonical track to inherit protection from for stem views. */
  parentTrackId?: bigint;
  /** Optional: show the full card with attestation details (default: compact badge). */
  expanded?: boolean;
}

interface TrustTierInfo {
  tier: string;
  escrowDays: number;
}

/**
 * Public-facing Content Protection badge.
 *
 * Reads on-chain stake and attestation data for a given tokenId and displays
 * status, amount, trust tier, and escrow countdown. Visible to all users
 * on release / stem detail pages.
 */
export default function ContentProtectionBadge({
  tokenId,
  parentTrackId,
  expanded = false,
}: ContentProtectionBadgeProps) {
  const protectionId = parentTrackId ?? tokenId;
  const inheritedProtection = parentTrackId !== undefined && parentTrackId !== tokenId;
  const { data: stakeData, loading: stakeLoading } = useStakeInfo(protectionId);
  const { data: attestData, loading: attestLoading } = useAttestationInfo(protectionId);

  // Fetch trust tier from backend (best-effort)
  const [trustTier, setTrustTier] = useState<TrustTierInfo | null>(null);

  useEffect(() => {
    if (!attestData?.attester || attestData.attester === "0x0000000000000000000000000000000000000000") return;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
    fetch(`${backendUrl}/api/trust-tier/${attestData.attester}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.tier) setTrustTier(data); })
      .catch(() => { /* graceful fallback */ });
  }, [attestData?.attester]);

  const loading = stakeLoading || attestLoading;

  // Don't render if still loading or no stake exists
  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span style={iconStyle}>🛡️</span>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>Content Protection</span>
        </div>
        <div style={{ opacity: 0.5, fontSize: "13px" }}>Loading…</div>
      </div>
    );
  }

  // If no data at all (contract not deployed or token doesn't exist), hide
  if (!stakeData) return null;

  const escrowDays = trustTier?.escrowDays ?? 30;
  const status = deriveStakeStatus(stakeData.active, stakeData.amount, stakeData.depositedAt, escrowDays);
  const escrow = deriveEscrowStatus(stakeData.active, stakeData.depositedAt, escrowDays);
  const tierLabel = trustTier ? (TIER_LABELS[trustTier.tier] || trustTier.tier) : null;
  const tierColor = trustTier ? (TIER_COLORS[trustTier.tier] || "#888") : null;

  // Compact badge: just status + amount in a single line
  if (!expanded) {
    return (
      <div style={compactStyle}>
        <span style={iconStyle}>🛡️</span>
        <span style={{
          fontWeight: 600,
          fontSize: "12px",
          color: STAKE_STATUS_COLORS[status],
        }}>
          {STAKE_STATUS_LABELS[status]}
        </span>
        {stakeData.amount > 0n && (
          <span style={{ opacity: 0.5, fontSize: "11px", marginLeft: "4px" }}>
            ({formatEth(stakeData.amount)})
          </span>
        )}
      </div>
    );
  }

  // Expanded card view
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={iconStyle}>🛡️</span>
        <span style={{ fontWeight: 600, fontSize: "14px" }}>Content Protection</span>
      </div>

      {/* Stake Status */}
      <div style={rowStyle}>
        <span style={{ opacity: 0.6, fontSize: "12px" }}>Stake Status</span>
        <span style={{
          fontWeight: 600,
          fontSize: "13px",
          color: STAKE_STATUS_COLORS[status],
        }}>
          {STAKE_STATUS_LABELS[status]}
        </span>
      </div>

      {/* Stake Amount */}
      {stakeData.amount > 0n && (
        <div style={rowStyle}>
          <span style={{ opacity: 0.6, fontSize: "12px" }}>Stake Amount</span>
          <span style={{ fontWeight: 600, fontSize: "13px" }}>
            {formatEth(stakeData.amount)}
          </span>
        </div>
      )}

      {/* Trust Tier */}
      {tierLabel && (
        <div style={rowStyle}>
          <span style={{ opacity: 0.6, fontSize: "12px" }}>Creator Trust Tier</span>
          <span style={{ fontWeight: 600, fontSize: "13px", color: tierColor || undefined }}>
            {tierLabel}
          </span>
        </div>
      )}

      {/* Escrow Status */}
      {escrow.status !== "none" && (
        <div style={rowStyle}>
          <span style={{ opacity: 0.6, fontSize: "12px" }}>Escrow</span>
          <span style={{ fontWeight: 500, fontSize: "13px" }}>
            {ESCROW_STATUS_LABELS[escrow.status]}
            {escrow.daysRemaining > 0 && ` (${escrow.daysRemaining}d remaining)`}
          </span>
        </div>
      )}

      {/* Attestation info */}
      {attestData?.valid && (
        <div style={{
          marginTop: "10px",
          padding: "8px 12px",
          background: "rgba(16, 185, 129, 0.08)",
          borderRadius: "8px",
          fontSize: "11px",
          color: "#10b981",
        }}>
          ✓ {inheritedProtection ? `Protection inherited from track #${protectionId.toString()}` : "Content attested on-chain"}
          {attestData.timestamp > 0n && (
            <span style={{ opacity: 0.6, marginLeft: "8px" }}>
              {new Date(Number(attestData.timestamp) * 1000).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Styles ----

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px",
  marginTop: "16px",
  overflow: "hidden",
};

const compactStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 10px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "20px",
  fontSize: "12px",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "14px",
};

const iconStyle: React.CSSProperties = {
  fontSize: "16px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 0",
};
