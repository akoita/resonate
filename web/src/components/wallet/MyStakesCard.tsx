"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { useStakeClaim } from "../../hooks/useContracts";
import {
  formatStakeAmount,
  formatOptionalDate,
  parseDateToEpochSeconds,
  deriveStakeStatus,
  deriveEscrowStatus,
  deriveStakeClaimAction,
  escrowDaysFromClaimableAt,
  STAKE_STATUS_LABELS,
  STAKE_STATUS_COLORS,
  ESCROW_STATUS_LABELS,
  type StakeClaimAction,
  type StakeStatus,
  type EscrowStatus,
} from "../../lib/stakeConstants";

interface StakeRecord {
  tokenId: string;
  releaseTitle?: string;
  amount: string;       // base units of the stake asset
  assetSymbol?: string;
  assetDecimals?: number;
  amountUsd?: string | null;
  depositedAt: string;  // ISO timestamp from backend
  active: boolean;
  escrowDays?: number;
  /** #1759: live claim state from ContentProtection.getStakeClaimState. */
  claimableAt?: string | null;
  failSafeAt?: string | null;
  locked?: boolean | null;
  claimable?: boolean;
}

interface DerivedStake extends StakeRecord {
  status: StakeStatus;
  escrow: { status: EscrowStatus; daysRemaining: number };
  action: StakeClaimAction;
}

/**
 * Wallet dashboard card showing all stakes for the authenticated user.
 *
 * Fetches from the backend indexer (`/api/metadata/stakes/:owner`), which adds
 * the contract's live claim state. A creator claims their own stake back with
 * `claimStakeRefund` (#1759); the Claim button appears only when the contract
 * says the claim would succeed. Falls back to an empty state when the endpoint
 * is unavailable.
 */
export default function MyStakesCard() {
  const { address } = useAuth();
  const { addToast } = useToast();
  const { claim, pending } = useStakeClaim();
  const [stakes, setStakes] = useState<DerivedStake[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingTokenId, setClaimingTokenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const handleClaim = useCallback(
    async (stake: DerivedStake) => {
      setClaimingTokenId(stake.tokenId);
      try {
        await claim(BigInt(stake.tokenId));
        addToast({
          type: "success",
          title: "Stake claimed",
          message: `${formatStakeAmount(stake.amount, { symbol: stake.assetSymbol, decimals: stake.assetDecimals, usd: stake.amountUsd })} is on its way back to your wallet.`,
        });
        setReloadKey((key) => key + 1);
      } catch (err) {
        addToast({
          type: "error",
          title: "Could not claim this stake",
          message: err instanceof Error ? err.message : String(err),
          duration: 9000,
        });
      } finally {
        setClaimingTokenId(null);
      }
    },
    [addToast, claim],
  );

  // Fetch stakes from backend
  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }

    fetch(`/api/metadata/stakes/${address}`)
      .then(r => {
        if (!r.ok) throw new Error("Stakes endpoint not available");
        return r.json();
      })
      .then((resp: { stakes: StakeRecord[] }) => {
        const data = resp.stakes || [];
        const derived = data.map(s => {
          const depositedEpoch = parseDateToEpochSeconds(s.depositedAt);
          const hasDepositedAt = depositedEpoch > 0n;
          // Prefer the escrow the contract recorded for this stake (#1759).
          const escrowDays = escrowDaysFromClaimableAt(s.depositedAt, s.claimableAt) ?? s.escrowDays ?? 30;

          return {
            ...s,
            status: hasDepositedAt
              ? deriveStakeStatus(
                  s.active,
                  BigInt(s.amount),
                  depositedEpoch,
                  escrowDays,
                )
              : s.active
                ? "active"
                : "refunded",
            escrow: hasDepositedAt
              ? deriveEscrowStatus(
                  s.active,
                  depositedEpoch,
                  escrowDays,
                )
              : { status: s.active ? "locked" as const : "released" as const, daysRemaining: 0 },
            action: deriveStakeClaimAction(s),
          };
        });
        setStakes(derived);
        setLoading(false);
      })
      .catch(() => {
        // Endpoint not available yet — show empty state
        setStakes([]);
        setLoading(false);
      });
  }, [address, reloadKey]);

  if (!address) return null;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: "18px" }}>🛡️</span>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>My Stakes</h3>
          <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>
            Content Protection deposits — claim yours back once its escrow ends
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", opacity: 0.5, fontSize: "13px" }}>
          Loading stakes…
        </div>
      )}

      {/* Empty state */}
      {!loading && stakes.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>🔒</div>
          <p style={{ margin: 0, fontWeight: 500, fontSize: "14px" }}>No stakes found</p>
          <p style={{ margin: "4px 0 0", fontSize: "12px", opacity: 0.5 }}>
            Stakes are created when you publish content with Content Protection enabled.
          </p>
        </div>
      )}

      {/* Stakes table */}
      {stakes.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Release</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Deposited</th>
                <th style={thStyle}>Escrow</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stakes.map(stake => (
                <tr key={stake.tokenId} style={trStyle}>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "13px", fontWeight: 500 }}>
                      {stake.releaseTitle || `Stake #${stake.tokenId.slice(0, 6)}…`}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 500 }}>
                      {formatStakeAmount(stake.amount, {
                        symbol: stake.assetSymbol,
                        decimals: stake.assetDecimals,
                        usd: stake.amountUsd,
                      })}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "12px", opacity: 0.7 }}>
                      {formatOptionalDate(stake.depositedAt)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: "12px" }}>
                      {ESCROW_STATUS_LABELS[stake.escrow.status]}
                      {stake.escrow.daysRemaining > 0 && (
                        <span style={{ opacity: 0.5, marginLeft: "4px" }}>
                          ({stake.escrow.daysRemaining}d)
                        </span>
                      )}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontWeight: 600,
                      fontSize: "12px",
                      color: STAKE_STATUS_COLORS[stake.status],
                    }}>
                      {STAKE_STATUS_LABELS[stake.status]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {/* The Claim button renders only when the contract says
                        claimStakeRefund would succeed (#1759); otherwise the
                        cell says why not, so there is never a dead control. */}
                    {stake.action.kind === "claim" ? (
                      <button
                        type="button"
                        style={claimButtonStyle}
                        disabled={pending}
                        aria-busy={claimingTokenId === stake.tokenId}
                        onClick={() => handleClaim(stake)}
                      >
                        {claimingTokenId === stake.tokenId ? "Claiming…" : "Claim"}
                      </button>
                    ) : (
                      <span
                        style={{
                          fontSize: "11px",
                          opacity: stake.action.kind === "on_hold" ? 0.85 : 0.5,
                          color: stake.action.kind === "on_hold" ? "#f59e0b" : undefined,
                        }}
                        title={stake.action.detail}
                      >
                        {stake.action.label}
                      </span>
                    )}
                    {stake.action.detail && stake.action.kind === "on_hold" && (
                      <div style={{ fontSize: "10px", opacity: 0.5, marginTop: "2px" }}>
                        {stake.action.detail}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Styles ----

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px",
  padding: "20px",
  gridColumn: "1 / -1", // span full width of vault grid
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "20px",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "32px 16px",
  opacity: 0.7,
};



const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  fontSize: "11px",
  fontWeight: 500,
  opacity: 0.5,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const trStyle: React.CSSProperties = {
  transition: "background 0.15s",
};

const claimButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "8px",
  border: "1px solid rgba(16,185,129,0.4)",
  background: "rgba(16,185,129,0.12)",
  color: "#10b981",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.03)",
};

