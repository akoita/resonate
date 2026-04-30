"use client";

import { useState } from "react";
import { fundLocalDevWallet, type FundingOption } from "../../lib/payments";

type FundingActionsProps = {
  options: FundingOption[];
  wallet?: string | null;
  token?: string | null;
  disabled?: boolean;
  onFunded?: () => void;
};

function describeFundingKind(kind: FundingOption["kind"]) {
  switch (kind) {
    case "local_faucet":
      return "Local";
    case "testnet_faucet":
      return "Faucet";
    case "onramp":
      return "On-ramp";
    case "offramp":
      return "Off-ramp";
    case "transfer":
      return "Transfer";
  }
}

export function FundingActions({
  options,
  wallet,
  token,
  disabled = false,
  onFunded,
}: FundingActionsProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (options.length === 0) return null;

  const runEndpoint = async (option: FundingOption) => {
    if (!wallet) {
      setStatus("Connect wallet to use funding actions.");
      return;
    }
    try {
      setPendingId(option.id);
      setStatus(null);
      const result = await fundLocalDevWallet({
        wallet,
        assetId: option.assetId,
        token,
        endpoint: option.endpoint,
      });
      setStatus(result.status === "funded" ? `Funded ${result.amount ?? option.label}` : result.status);
      onFunded?.();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="vault-funding-actions">
      <div className="vault-funding-actions__header">
        <span className="vault-funding-actions__title">Funding</span>
        <span className="vault-funding-actions__hint">Gas and settlement assets</span>
      </div>
      <div className="vault-funding-actions__buttons">
        {options.map((option) => {
          const label = `${describeFundingKind(option.kind)} · ${option.label}`;
          if (option.endpoint) {
            return (
              <button
                key={option.id}
                className="vault-btn vault-btn--ghost vault-btn--sm"
                disabled={disabled || pendingId === option.id}
                onClick={() => runEndpoint(option)}
                type="button"
              >
                {pendingId === option.id ? "Funding..." : label}
              </button>
            );
          }
          if (option.url) {
            return (
              <a
                key={option.id}
                className="vault-btn vault-btn--ghost vault-btn--sm"
                href={option.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                {label}
              </a>
            );
          }
          return (
            <button
              key={option.id}
              className="vault-btn vault-btn--ghost vault-btn--sm"
              disabled
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
      {status && <div className="vault-funding-actions__status">{status}</div>}
    </div>
  );
}
