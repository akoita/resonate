"use client";

import { useState } from "react";
import { type TrustTier } from "../../lib/api";

const TIER_LABELS: Record<string, string> = {
  new: "New Creator",
  established: "Established",
  trusted: "Trusted",
  verified: "Verified ✓",
};

const TIER_COLORS: Record<string, string> = {
  new: "#f59e0b",
  established: "#3b82f6",
  trusted: "#8b5cf6",
  verified: "#10b981",
};

function formatEth(wei: string): string {
  const eth = Number(wei) / 1e18;
  if (eth === 0) return "Waived";
  return `${eth} ETH`;
}

function formatMaxListingPrice(trustTier: TrustTier): string {
  if (trustTier.maxListingPriceUncapped || !trustTier.maxListingPriceWei) {
    return "Uncapped";
  }
  return formatEth(trustTier.maxListingPriceWei);
}

interface StakeDepositCardProps {
  trustTier: TrustTier | null;
  loading: boolean;
  /** Called when user acknowledges the stake requirement. */
  onStakeAcknowledged?: () => void;
}

/**
 * Informational card showing the content protection stake requirements.
 *
 * The actual attestRelease() + stakeForRelease() calls happen during the publish flow
 * (after the backend assigns the release protection id and content hashes), not here.
 * This card is a visual gate that shows the user what will be required.
 */
export default function StakeDepositCard({ trustTier, loading, onStakeAcknowledged }: StakeDepositCardProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span style={iconStyle}>🔒</span>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>Content Protection Stake</span>
        </div>
        <div style={{ opacity: 0.5, fontSize: "13px" }}>Loading trust tier...</div>
      </div>
    );
  }

  if (!trustTier) return null;

  const tierLabel = TIER_LABELS[trustTier.tier] || trustTier.tier;
  const tierColor = TIER_COLORS[trustTier.tier] || "#888";
  const stakeEth = formatEth(trustTier.stakeAmountWei);
  const maxListingPrice = formatMaxListingPrice(trustTier);
  const isWaived = trustTier.stakeAmountWei === "0";

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={iconStyle}>🛡️</span>
        <span style={{ fontWeight: 600, fontSize: "14px" }}>Content Protection</span>
        {isWaived && <span style={{ marginLeft: "auto", color: "#10b981", fontSize: "12px" }}>✓ Waived</span>}
      </div>

      <div style={rowStyle}>
        <span style={{ opacity: 0.6, fontSize: "12px" }}>Trust Tier</span>
        <span style={{ fontWeight: 600, fontSize: "13px", color: tierColor }}>{tierLabel}</span>
      </div>

      <div style={rowStyle}>
        <span style={{ opacity: 0.6, fontSize: "12px" }}>Stake Required</span>
        <span style={{
          fontWeight: 600,
          fontSize: "13px",
          color: isWaived ? "#10b981" : "#f59e0b"
        }}>
          {stakeEth}
        </span>
      </div>

      <div style={rowStyle}>
        <span style={{ opacity: 0.6, fontSize: "12px" }}>Escrow Period</span>
        <span style={{ fontWeight: 500, fontSize: "13px" }}>{trustTier.escrowDays} days</span>
      </div>

      <div style={rowStyle}>
        <span
          style={{ opacity: 0.6, fontSize: "12px" }}
          title="Your maximum listing price per unit is derived from the active Content Protection stake for this release."
        >
          Max Listing Price
        </span>
        <span style={{ fontWeight: 500, fontSize: "13px" }}>{maxListingPrice}</span>
      </div>

      <div style={{
        marginTop: "12px",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: "8px",
        fontSize: "11px",
        lineHeight: "1.5",
        opacity: 0.5,
      }}>
        {isWaived ? (
          <>Your verified status waives the stake requirement. Revenue is held in escrow for {trustTier.escrowDays} days, and listings remain uncapped unless a stake is later configured.</>
        ) : (
          <>A refundable stake of <strong style={{ color: "#f59e0b" }}>{stakeEth}</strong> will be deposited
            on publish to protect against copyright violations. Revenue is held in escrow for {trustTier.escrowDays} days.
            Your current max listing price per unit is <strong>{maxListingPrice}</strong>. As you build clean history, your stake decreases.</>
        )}
      </div>

      {/* Acknowledge button for non-waived stakes */}
      {!isWaived && !acknowledged && onStakeAcknowledged && (
        <button
          onClick={() => {
            setAcknowledged(true);
            onStakeAcknowledged();
          }}
          style={{
            marginTop: "14px",
            width: "100%",
            padding: "10px 0",
            border: "none",
            borderRadius: "8px",
            background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          I understand — {stakeEth} will be deposited on publish
        </button>
      )}

      {!isWaived && acknowledged && (
        <div style={{
          marginTop: "10px",
          padding: "8px 12px",
          background: "rgba(16, 185, 129, 0.1)",
          borderRadius: "8px",
          fontSize: "11px",
          color: "#10b981",
        }}>
          ✓ Stake requirement acknowledged — {stakeEth} will be deposited on publish
        </div>
      )}

      {trustTier.totalUploads > 0 && (
        <div style={{
          marginTop: "10px",
          display: "flex",
          gap: "16px",
          fontSize: "11px",
          opacity: 0.4,
        }}>
          <span>{trustTier.totalUploads} uploads</span>
          <span>{trustTier.cleanHistory} clean</span>
          {trustTier.disputesLost > 0 && (
            <span style={{ color: "#ef4444" }}>{trustTier.disputesLost} disputes lost</span>
          )}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px",
  marginTop: "16px",
  overflow: "hidden",
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
