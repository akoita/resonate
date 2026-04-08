"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useStakeRefund } from "../../hooks/useContracts";
import {
  formatEth,
  formatOptionalDate,
  parseDateToEpochSeconds,
  deriveStakeStatus,
  deriveEscrowStatus,
  STAKE_STATUS_LABELS,
  STAKE_STATUS_COLORS,
  ESCROW_STATUS_LABELS,
  type StakeStatus,
  type EscrowStatus,
} from "../../lib/stakeConstants";

interface StakeRecord {
  tokenId: string;
  releaseTitle?: string;
  amount: string;       // wei string
  depositedAt: string;  // ISO timestamp from backend
  active: boolean;
  escrowDays: number;
}

interface DerivedStake extends StakeRecord {
  status: StakeStatus;
  escrow: { status: EscrowStatus; daysRemaining: number };
}

/**
 * Wallet dashboard card showing all stakes for the authenticated user.
 *
 * Fetches from backend indexer `/api/stakes?owner=`.
 * Falls back to an empty state when the endpoint is unavailable.
 */
export default function MyStakesCard() {
  const { address } = useAuth();
  const { refund, pending: refundPending, error: refundError, txHash: refundTx } = useStakeRefund();

  const [stakes, setStakes] = useState<DerivedStake[]>([]);
  const [loading, setLoading] = useState(true);
  const [refundingTokenId, setRefundingTokenId] = useState<string | null>(null);

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

          return {
            ...s,
            status: hasDepositedAt
              ? deriveStakeStatus(
                  s.active,
                  BigInt(s.amount),
                  depositedEpoch,
                  s.escrowDays || 30,
                )
              : s.active
                ? "active"
                : "refunded",
            escrow: hasDepositedAt
              ? deriveEscrowStatus(
                  s.active,
                  depositedEpoch,
                  s.escrowDays || 30,
                )
              : { status: s.active ? "locked" as const : "released" as const, daysRemaining: 0 },
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
  }, [address]);

  const handleWithdraw = useCallback(async (tokenId: string) => {
    setRefundingTokenId(tokenId);
    try {
      await refund(BigInt(tokenId));
      // Optimistically update the local state
      setStakes(prev =>
        prev.map(s =>
          s.tokenId === tokenId
            ? { ...s, status: "refunded" as StakeStatus, active: false, escrow: { status: "released" as EscrowStatus, daysRemaining: 0 } }
            : s
        )
      );
    } catch {
      // error is already captured in refundError
    } finally {
      setRefundingTokenId(null);
    }
  }, [refund]);

  if (!address) return null;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: "18px" }}>🛡️</span>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>My Stakes</h3>
          <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>Content Protection deposits</p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", opacity: 0.5, fontSize: "13px" }}>
          Loading stakes…
        </div>
      )}

      {/* Error banner */}
      {refundError && (
        <div style={errorBannerStyle}>
          {refundError.message}
        </div>
      )}

      {/* Success banner */}
      {refundTx && (
        <div style={successBannerStyle}>
          ✓ Refund submitted — tx: {refundTx.slice(0, 10)}…
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
                      {formatEth(stake.amount)}
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
                    {stake.status === "releasable" && (
                      <button
                        onClick={() => handleWithdraw(stake.tokenId)}
                        disabled={refundPending && refundingTokenId === stake.tokenId}
                        style={withdrawButtonStyle}
                      >
                        {refundPending && refundingTokenId === stake.tokenId
                          ? "Withdrawing…"
                          : "Withdraw"
                        }
                      </button>
                    )}
                    {stake.status === "active" && (
                      <span style={{ fontSize: "11px", opacity: 0.4 }}>Locked</span>
                    )}
                    {(stake.status === "refunded" || stake.status === "slashed") && (
                      <span style={{ fontSize: "11px", opacity: 0.4 }}>—</span>
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

const errorBannerStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "rgba(239, 68, 68, 0.1)",
  border: "1px solid rgba(239, 68, 68, 0.2)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#ef4444",
  marginBottom: "12px",
};

const successBannerStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "rgba(16, 185, 129, 0.1)",
  border: "1px solid rgba(16, 185, 129, 0.2)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#10b981",
  marginBottom: "12px",
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

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.03)",
};

const withdrawButtonStyle: React.CSSProperties = {
  padding: "5px 14px",
  border: "none",
  borderRadius: "6px",
  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  color: "#fff",
  fontWeight: 600,
  fontSize: "12px",
  cursor: "pointer",
  transition: "all 0.2s",
};
