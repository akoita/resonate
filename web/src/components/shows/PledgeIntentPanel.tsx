"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  useShowPledgeExecution,
  useShowRefundExecution,
  type ShowPledgeExecutionResult,
} from "../../hooks/useShowPledgeExecution";
import { getExplorerTxUrl } from "../../lib/explorer";
import { formatPaymentAmountWithSymbol } from "../../lib/payments";
import {
  campaignPledgeAvailability,
  campaignFeeNotice,
  createPledgeIntent,
  formatMoney,
  listMyShowPledges,
  pledgeConfirmSummary,
  pledgeStateLabel,
  type Campaign,
  type CampaignTier,
  type ShowPledgeIntent,
  type ShowPledgeReceipt,
} from "../../lib/shows";

interface Props {
  campaign: Campaign;
  fallbackTiers: CampaignTier[];
}

export function PledgeIntentPanel({ campaign, fallbackTiers }: Props) {
  const { address, smartAccountAddress, token, status, connect } = useAuth();
  const { chainId } = useZeroDev();
  const { executePledge, phase, pending, error: executionError, txHash } = useShowPledgeExecution();
  const {
    claimRefund,
    phase: refundPhase,
    pending: refundPending,
    error: refundError,
    txHash: refundTxHash,
  } = useShowRefundExecution();
  const availability = campaignPledgeAvailability(campaign);
  const pledgingOpen = availability.open;
  const tiers = campaign.tiers.length > 0 ? campaign.tiers : fallbackTiers;
  const [selectedTierId, setSelectedTierId] = useState(tiers[1]?.id ?? tiers[0]?.id ?? "");
  const [intent, setIntent] = useState<ShowPledgeIntent | null>(null);
  const [execution, setExecution] = useState<ShowPledgeExecutionResult | null>(null);
  const [refundExecution, setRefundExecution] = useState<ShowPledgeExecutionResult | null>(null);
  const [myPledges, setMyPledges] = useState<ShowPledgeReceipt[]>([]);
  const [myPledgesLoading, setMyPledgesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedTier = useMemo(
    () => tiers.find((tier) => tier.id === selectedTierId) ?? tiers[0],
    [selectedTierId, tiers],
  );
  const walletAddress = smartAccountAddress || address;
  const activeError = error ?? executionError?.message ?? refundError?.message ?? null;
  const explorerTxUrl = getExplorerTxUrl(execution?.transactionHash ?? txHash);
  const latestPledge = myPledges[0] ?? null;
  const latestPledgeTxUrl = getExplorerTxUrl(
    refundExecution?.transactionHash ?? refundTxHash ?? latestPledge?.transactionHash,
  );
  const latestPledgeAmount = latestPledge
    ? formatPaymentAmountWithSymbol(
      latestPledge.amountUnits,
      latestPledge.paymentAssetDecimals,
      latestPledge.paymentAssetSymbol ?? latestPledge.currency,
    )
    : null;
  const latestPledgeCampaignStatus = latestPledge?.campaign?.status ?? campaign.rawStatus;
  const feeNotice = campaignFeeNotice(campaign);
  const refundAvailable = Boolean(
    latestPledge &&
    latestPledge.status !== "refunded" &&
    (
      latestPledge.status === "refund_available" ||
      latestPledgeCampaignStatus === "refund_available"
    ),
  );

  const buttonLabel = useMemo(() => {
    if (loading) return "Preparing receipt...";
    if (phase === "checking") return "Checking allowance...";
    if (phase === "signing") return "Awaiting wallet signature...";
    if (phase === "confirming") return "Confirming pledge...";
    if (status !== "authenticated") return "Connect wallet to pledge";
    return "Pledge with wallet";
  }, [loading, phase, status]);

  const refundButtonLabel = useMemo(() => {
    if (refundPhase === "checking") return "Checking refund...";
    if (refundPhase === "signing") return "Awaiting refund signature...";
    if (refundPhase === "confirming") return "Confirming refund...";
    return "Claim refund";
  }, [refundPhase]);

  useEffect(() => {
    if (!token || !walletAddress) {
      setMyPledges([]);
      return;
    }

    let active = true;
    setMyPledgesLoading(true);
    listMyShowPledges({ token, walletAddress, chainId })
      .then((pledges) => {
        if (!active) return;
        setMyPledges(pledges.filter((pledge) => pledge.campaignId === campaign.backendId));
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load your pledge receipts.");
      })
      .finally(() => {
        if (active) setMyPledgesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [campaign.backendId, chainId, token, walletAddress]);

  async function pledge() {
    if (!selectedTier) return;
    if (!token || !walletAddress) {
      await connect();
      return;
    }

    setLoading(true);
    setError(null);
    setIntent(null);
    setExecution(null);
    setRefundExecution(null);
    try {
      const next = await createPledgeIntent({
        campaign,
        tierId: selectedTier.id,
        walletAddress,
        token,
      });
      setIntent(next);
      if (next.contractCall) {
        const result = await executePledge(next);
        setExecution(result);
        setMyPledges((pledges) => [
          result.confirmation.pledge,
          ...pledges.filter((pledge) => pledge.id !== result.confirmation.pledge.id),
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete pledge.");
    } finally {
      setLoading(false);
    }
  }

  // #1240: gate the wallet signature behind an explicit terms confirmation.
  // If the wallet isn't connected yet, connect first (no dialog); otherwise
  // open the confirm dialog and run the pledge only once the fan confirms.
  async function handlePledgeClick() {
    if (!selectedTier) return;
    if (!token || !walletAddress) {
      await connect();
      return;
    }
    setConfirmOpen(true);
  }

  async function refund() {
    if (!latestPledge) return;
    if (!token || !walletAddress) {
      await connect();
      return;
    }

    setError(null);
    setRefundExecution(null);
    try {
      const result = await claimRefund({ pledge: latestPledge, campaign });
      setRefundExecution(result);
      setMyPledges((pledges) => [
        result.confirmation.pledge,
        ...pledges.filter((pledge) => pledge.id !== result.confirmation.pledge.id),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim refund.");
    }
  }

  return (
    <article className="show-detail__pledge-panel" aria-label="Pledge tiers">
      <div className="show-detail__pledge-header">
        <span className="shows-home-section__kicker">Signal tiers</span>
        <span className="show-detail__soon-pill">{pledgingOpen ? "Receipt-ready" : "Preview"}</span>
      </div>

      {pledgingOpen ? (
        <div className="show-detail__tiers" role="group" aria-label="Pledge tiers">
          {tiers.map((tier, index) => {
            const selected = tier.id === selectedTier?.id;
            return (
              <button
                key={tier.id}
                type="button"
                className={`show-detail__tier ${index === 1 ? "show-detail__tier--featured" : ""} ${
                  selected ? "show-detail__tier--selected" : ""
                }`}
                onClick={() => setSelectedTierId(tier.id)}
                aria-pressed={selected}
              >
                <strong>{formatMoney(tier.amountCents, tier.currency)}</strong>
                <span>{tier.title}</span>
                {tier.description ? (
                  <small>{tier.description}</small>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="show-detail__pledge-empty" role="note" data-state={availability.key}>
          <strong>{availability.title}</strong>
          <p>{availability.message}</p>
        </div>
      )}

      {latestPledge || myPledgesLoading ? (
        <div className="show-detail__my-pledge" aria-live="polite">
          <span>Your pledge</span>
          {latestPledge ? (
            <>
              <strong>{latestPledgeAmount}</strong>
              <small>{pledgeStateLabel(latestPledge.status, latestPledge.confirmationStatus)}</small>
              {latestPledgeTxUrl ? (
                <a href={latestPledgeTxUrl} target="_blank" rel="noreferrer noopener">
                  View transaction
                </a>
              ) : null}
              {refundAvailable ? (
                <button
                  type="button"
                  className="show-detail__refund-action"
                  onClick={refund}
                  disabled={refundPending}
                >
                  {refundButtonLabel}
                </button>
              ) : null}
            </>
          ) : (
            <small>Loading receipts...</small>
          )}
        </div>
      ) : null}

      {pledgingOpen ? (
        <button
          type="button"
          className="show-detail__pledge-action"
          onClick={handlePledgeClick}
          disabled={loading || pending || refundPending || !selectedTier}
        >
          {buttonLabel}
        </button>
      ) : null}

      {pledgingOpen && feeNotice ? (
        <p className="show-detail__fee-note">{feeNotice}</p>
      ) : null}

      {intent ? (
        <div className="show-detail__pledge-result" role="status">
          <strong>{execution ? "Pledge confirmed" : "Receipt created"}</strong>
          <span>Receipt {intent.pledge.receiptId ?? intent.pledge.id}</span>
          {execution ? (
            explorerTxUrl ? (
              <a href={explorerTxUrl} target="_blank" rel="noreferrer noopener">
                View transaction
              </a>
            ) : (
              <code>{execution.transactionHash}</code>
            )
          ) : intent.contractCall ? (
            <code>
              {intent.contractCall.functionName}({intent.contractCall.args.join(", ")})
            </code>
          ) : (
            <span>Contract call will appear once escrow deployment is linked.</span>
          )}
        </div>
      ) : null}

      {activeError ? (
        <p className="show-detail__pledge-error" role="alert">
          {activeError}
        </p>
      ) : null}

      {pledgingOpen && selectedTier ? (
        <ConfirmDialog
          isOpen={confirmOpen}
          title="Confirm your pledge"
          message={pledgeConfirmSummary(campaign, selectedTier)}
          confirmLabel="Pledge with wallet"
          cancelLabel="Cancel"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            setConfirmOpen(false);
            await pledge();
          }}
        />
      ) : null}
    </article>
  );
}
