"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  formatEth,
  formatOptionalDate,
  parseDateToEpochSeconds,
  deriveStakeStatus,
  deriveEscrowStatus,
  STAKE_STATUS_LABELS,
  STAKE_STATUS_COLORS,
  ESCROW_STATUS_LABELS,
  stakeActionLabel,
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
  const [stakes, setStakes] = useState<DerivedStake[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (!address) return null;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: "18px" }}>🛡️</span>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>My Stakes</h3>
          <p style={{ margin: 0, fontSize: "12px", opacity: 0.5 }}>
            Content Protection deposits — returned by Resonate after the escrow period
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
                    {/* No control here: refundStake is owner-only on-chain, so
                        a Withdraw button could never succeed for its viewer.
                        #1759 tracks the self-service claim that would earn one. */}
                    <span style={{ fontSize: "11px", opacity: 0.4 }}>
                      {stakeActionLabel(stake.status)}
                    </span>
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

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.03)",
};

