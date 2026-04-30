"use client";

import { useState } from "react";
import {
  fundLocalDevWallet,
  groupFundingOptions,
  type FundingOption,
} from "../../lib/payments";

type FundingActionsProps = {
  options: FundingOption[];
  wallet?: string | null;
  token?: string | null;
  disabled?: boolean;
  onFunded?: () => void;
};

export function FundingActions({
  options,
  wallet,
  token,
  disabled = false,
  onFunded,
}: FundingActionsProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const groups = groupFundingOptions(options);

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

  const copyWallet = async (option: FundingOption) => {
    if (!wallet) {
      setStatus("Connect wallet to copy a funding address.");
      return;
    }
    await navigator.clipboard.writeText(wallet);
    setStatus(`${option.label}: address copied.`);
  };

  const disabledReason = (option: FundingOption) => {
    if (option.disabledReason) return option.disabledReason;
    if (option.requiresWallet && !wallet) return "Connect wallet first.";
    if ((option.kind === "onramp" || option.kind === "offramp") && !option.url && !option.endpoint) {
      return "Provider not configured.";
    }
    return null;
  };

  return (
    <div className="vault-funding-actions">
      <div className="vault-funding-actions__header">
        <span className="vault-funding-actions__title">Funding</span>
        <span className="vault-funding-actions__hint">Gas and settlement assets</span>
      </div>
      <div className="vault-funding-actions__groups">
        {groups.map((group) => (
          <div key={group.kind} className="vault-funding-group">
            <div className="vault-funding-group__heading">
              <span className="vault-funding-group__eyebrow">{group.eyebrow}</span>
              <span className="vault-funding-group__title">{group.title}</span>
            </div>
            <div className="vault-funding-group__options">
              {group.options.map((option) => {
                const reason = disabledReason(option);
                const meta = [option.provider, option.region].filter(Boolean).join(" · ");
                const buttonDisabled = disabled || pendingId === option.id || Boolean(reason);
                return (
                  <div key={option.id} className="vault-funding-option">
                    <div className="vault-funding-option__copy">
                      <span className="vault-funding-option__label">{option.label}</span>
                      {(option.description || meta || reason) && (
                        <span className="vault-funding-option__description">
                          {reason ?? option.description ?? meta}
                          {!reason && option.description && meta ? ` · ${meta}` : ""}
                        </span>
                      )}
                    </div>
                    {option.endpoint ? (
                      <button
                        className="vault-btn vault-btn--ghost vault-btn--sm"
                        disabled={buttonDisabled}
                        onClick={() => runEndpoint(option)}
                        type="button"
                      >
                        {pendingId === option.id ? "Funding..." : "Fund"}
                      </button>
                    ) : option.url ? (
                      <a
                        className={`vault-btn vault-btn--ghost vault-btn--sm${buttonDisabled ? " vault-btn--disabled" : ""}`}
                        href={buttonDisabled ? undefined : option.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-disabled={buttonDisabled}
                        style={{ textDecoration: "none" }}
                      >
                        Open
                      </a>
                    ) : option.kind === "transfer" ? (
                      <button
                        className="vault-btn vault-btn--ghost vault-btn--sm"
                        disabled={buttonDisabled}
                        onClick={() => copyWallet(option)}
                        type="button"
                      >
                        Copy address
                      </button>
                    ) : (
                      <button
                        className="vault-btn vault-btn--ghost vault-btn--sm"
                        disabled
                        type="button"
                      >
                        Unavailable
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {status && <div className="vault-funding-actions__status">{status}</div>}
    </div>
  );
}
