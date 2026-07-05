"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { formatPaymentAmountWithSymbol } from "../../lib/payments";
import {
  activateShowCampaign,
  approveShowCampaignAuthority,
  cancelShowCampaign,
  formatCampaignFeePercent,
  confirmShowCampaignBooking,
  confirmShowCampaignFulfillment,
  getManagedShowCampaign,
  initiateShowCampaignDispute,
  resyncShowCampaignFromChain,
  resolveShowCampaignDispute,
  type Campaign,
} from "../../lib/shows";

type ActionKey =
  | "authority"
  | "activate"
  | "resync"
  | "cancel"
  | "booking"
  | "fulfillment"
  | "dispute"
  | "resolve";

type DisputeOutcome = "upheld" | "rejected" | "inconclusive";

const AUTHORIZED_STATUSES = ["artist_authorized", "trusted_source_authorized"];

function formatStatus(value?: string | null) {
  return value ? value.replaceAll("_", " ") : "not set";
}

function campaignNetEstimate(campaign: Campaign) {
  const netUnits = campaign.campaignFeeBreakdown?.estimatedNetToArtistAtGoalUnits;
  if (!netUnits) return null;
  return formatPaymentAmountWithSymbol(
    netUnits,
    campaign.paymentAssetDecimals ?? 6,
    campaign.paymentAssetSymbol ?? campaign.currency,
  );
}

export function CampaignOperatorPanel({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const { role, token, status } = useAuth();
  const [current, setCurrent] = useState(campaign);
  const [beneficiaryAddress, setBeneficiaryAddress] = useState(campaign.beneficiaryAddress ?? "");
  const [beneficiaryType, setBeneficiaryType] = useState<"wallet" | "split_contract" | "multisig">(
    campaign.beneficiaryType === "split_contract" || campaign.beneficiaryType === "multisig"
      ? campaign.beneficiaryType
      : "wallet",
  );
  const [authorityCredentialId, setAuthorityCredentialId] = useState(campaign.authorityCredentialId ?? "");
  const [authorityEvidenceBundleId, setAuthorityEvidenceBundleId] = useState(campaign.authorityEvidenceBundleId ?? "");
  const [contractAddress, setContractAddress] = useState(campaign.escrowContractAddress ?? "");
  const [contractCampaignId, setContractCampaignId] = useState(campaign.contractCampaignId ?? "");
  const [lifecycleEvidenceBundleId, setLifecycleEvidenceBundleId] = useState("");
  const [reason, setReason] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [resolveOutcome, setResolveOutcome] = useState<DisputeOutcome>("upheld");
  const [resolveNote, setResolveNote] = useState("");
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const isOperator = role === "admin" || role === "operator";
  const isAuthenticated = status === "authenticated" && Boolean(token);

  const canApproveAuthority = current.rawStatus === "draft" && !AUTHORIZED_STATUSES.includes(current.artistAuthorityStatus);
  const canActivate = current.rawStatus === "draft" && AUTHORIZED_STATUSES.includes(current.artistAuthorityStatus);
  const canCancel = ["draft", "active", "funded", "booking_confirmed"].includes(current.rawStatus);
  const canConfirmBooking = current.rawStatus === "funded";
  const canConfirmFulfillment = ["booking_confirmed", "deposit_released"].includes(current.rawStatus);

  const disputes = current.disputes ?? [];
  const openDispute = disputes.find((dispute) => dispute.status === "open") ?? null;
  const canInitiateDispute =
    !openDispute &&
    ["booking_confirmed", "deposit_released", "fulfilled"].includes(current.rawStatus);
  const netEstimateAtGoal = campaignNetEstimate(current);
  const feePercent = formatCampaignFeePercent(current.feeBps);

  const busy = pending !== null;
  const statusRows = useMemo(
    () => [
      ["Campaign", formatStatus(current.rawStatus)],
      ["Level", formatStatus(current.campaignLevel)],
      ["Artist authority", formatStatus(current.artistAuthorityStatus)],
      ["Beneficiary", current.beneficiaryAddress ? `${current.beneficiaryType ?? "wallet"} · ${current.beneficiaryAddress}` : "not bound"],
      ["Contract", current.contractCampaignId && current.escrowContractAddress
        ? `${current.contractCampaignId} · ${current.escrowContractAddress}`
        : current.escrowContractAddress ?? "not linked"],
      ...(netEstimateAtGoal
        ? [["Artist net at goal", feePercent ? `${netEstimateAtGoal} after ${feePercent} fee` : netEstimateAtGoal] as [string, string]]
        : []),
      ...(current.bookingEvidenceBundleId
        ? [["Booking evidence", current.bookingEvidenceBundleId] as [string, string]]
        : []),
      ...(current.fulfillmentEvidenceBundleId
        ? [["Fulfillment evidence", current.fulfillmentEvidenceBundleId] as [string, string]]
        : []),
    ],
    [current, feePercent, netEstimateAtGoal],
  );

  // #949: the public read withholds the authority credential/evidence ids, so
  // pull the operator-scoped managed read to prefill those inputs and load the
  // dispute list. Runs only for an authenticated operator/admin.
  useEffect(() => {
    if (!isOperator || !isAuthenticated || !token) return;
    let cancelled = false;
    void (async () => {
      const managed = await getManagedShowCampaign({ campaignId: campaign.backendId, token });
      if (cancelled || !managed) return;
      setCurrent(managed);
      setAuthorityCredentialId((prev) => prev || managed.authorityCredentialId || "");
      setAuthorityEvidenceBundleId((prev) => prev || managed.authorityEvidenceBundleId || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [isOperator, isAuthenticated, token, campaign.backendId]);

  if (!isOperator) return null;

  async function runAction(action: ActionKey, request: () => Promise<Campaign>, success: string) {
    if (!token) {
      setError("Connect with an operator account first.");
      return;
    }

    setPending(action);
    setError(null);
    setNotice(null);
    try {
      const updated = await request();
      setCurrent(updated);
      setNotice(success);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign operation failed.");
    } finally {
      setPending(null);
    }
  }

  // Dispute mutations return the dispute (not the campaign), so refetch the
  // managed read to refresh the panel's dispute list + status rows.
  async function runDisputeAction(action: "dispute" | "resolve", request: () => Promise<unknown>, success: string) {
    if (!token) {
      setError("Connect with an operator account first.");
      return;
    }
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      await request();
      const managed = await getManagedShowCampaign({ campaignId: current.backendId, token });
      if (managed) setCurrent(managed);
      setNotice(success);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispute operation failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <details className="show-detail__operator-panel" aria-label="Campaign operations">
      <summary className="show-detail__operator-summary">
        <div>
          <span className="shows-home-section__kicker">Operator controls</span>
          <h2>Campaign lifecycle</h2>
        </div>
        <div className="show-detail__operator-header-actions">
          {current.rawStatus === "draft" ? (
            <Link href={`/shows/${current.id}/edit`}>Edit draft</Link>
          ) : null}
          <span className="show-detail__soon-pill">{formatStatus(role)}</span>
        </div>
      </summary>

      <div className="show-detail__operator-status">
        {statusRows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <div className="show-detail__operator-grid">
        <fieldset>
          <legend>Artist authority</legend>
          <label>
            Beneficiary
            <input
              value={beneficiaryAddress}
              onChange={(event) => setBeneficiaryAddress(event.target.value)}
              placeholder="0x..."
            />
          </label>
          <label>
            Beneficiary type
            <select value={beneficiaryType} onChange={(event) => setBeneficiaryType(event.target.value as typeof beneficiaryType)}>
              <option value="wallet">Wallet</option>
              <option value="multisig">Multisig</option>
              <option value="split_contract">Split contract</option>
            </select>
          </label>
          <label>
            Credential ID
            <input value={authorityCredentialId} onChange={(event) => setAuthorityCredentialId(event.target.value)} />
          </label>
          <label>
            Evidence bundle
            <input value={authorityEvidenceBundleId} onChange={(event) => setAuthorityEvidenceBundleId(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => runAction(
              "authority",
              () => approveShowCampaignAuthority({
                campaign: current,
                token: token ?? "",
                authorityStatus: "artist_authorized",
                beneficiaryAddress,
                beneficiaryType,
                authorityCredentialId,
                authorityEvidenceBundleId,
              }),
              "Artist authority approved.",
            )}
            disabled={!isAuthenticated || busy || !canApproveAuthority || !beneficiaryAddress}
          >
            {pending === "authority" ? "Approving..." : "Approve authority"}
          </button>
        </fieldset>

        <fieldset>
          <legend>Activation</legend>
          <label>
            Escrow contract
            <input value={contractAddress} onChange={(event) => setContractAddress(event.target.value)} placeholder="0x..." />
          </label>
          <label>
            Contract campaign ID
            <input value={contractCampaignId} onChange={(event) => setContractCampaignId(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => runAction(
              "activate",
              () => activateShowCampaign({
                campaign: current,
                token: token ?? "",
                contractAddress,
                contractCampaignId,
              }),
              "Campaign activated.",
            )}
            disabled={!isAuthenticated || busy || !canActivate || !contractAddress || !contractCampaignId}
          >
            {pending === "activate" ? "Activating..." : "Activate campaign"}
          </button>
          <button
            type="button"
            onClick={() => runAction(
              "resync",
              () => resyncShowCampaignFromChain({
                campaign: current,
                token: token ?? "",
              }),
              "Campaign re-synced from chain.",
            )}
            disabled={!isAuthenticated || busy || !current.escrowContractAddress || !current.contractCampaignId}
          >
            {pending === "resync" ? "Re-syncing..." : "Re-sync from chain"}
          </button>
        </fieldset>

        <fieldset>
          <legend>Lifecycle evidence</legend>
          <label>
            Evidence bundle
            <input value={lifecycleEvidenceBundleId} onChange={(event) => setLifecycleEvidenceBundleId(event.target.value)} />
          </label>
          <label>
            Reason / note
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
          <div className="show-detail__operator-actions">
            <button
              type="button"
              onClick={() => runAction(
                "booking",
                () => confirmShowCampaignBooking({
                  campaign: current,
                  token: token ?? "",
                  evidenceBundleId: lifecycleEvidenceBundleId,
                  reason,
                }),
                "Booking confirmed.",
              )}
              disabled={!isAuthenticated || busy || !canConfirmBooking}
            >
              {pending === "booking" ? "Confirming..." : "Confirm booking"}
            </button>
            <button
              type="button"
              onClick={() => runAction(
                "fulfillment",
                () => confirmShowCampaignFulfillment({
                  campaign: current,
                  token: token ?? "",
                  evidenceBundleId: lifecycleEvidenceBundleId,
                  reason,
                }),
                "Fulfillment confirmed.",
              )}
              disabled={!isAuthenticated || busy || !canConfirmFulfillment}
            >
              {pending === "fulfillment" ? "Confirming..." : "Confirm fulfillment"}
            </button>
            <button
              type="button"
              className="show-detail__operator-danger"
              onClick={() => setConfirmCancelOpen(true)}
              disabled={!isAuthenticated || busy || !canCancel}
            >
              Cancel to refunds
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Disputes</legend>
          {openDispute ? (
            <div className="show-detail__operator-dispute">
              <p className="show-detail__operator-dispute-head">
                <strong>Open dispute</strong>
                {openDispute.initiatorRole ? ` · raised by ${formatStatus(openDispute.initiatorRole)}` : null}
              </p>
              {openDispute.reason ? (
                <p className="show-detail__operator-dispute-reason">{openDispute.reason}</p>
              ) : null}
              <label>
                Outcome
                <select
                  value={resolveOutcome}
                  onChange={(event) => setResolveOutcome(event.target.value as DisputeOutcome)}
                >
                  <option value="upheld">Upheld — backer concern valid</option>
                  <option value="rejected">Rejected — no issue found</option>
                  <option value="inconclusive">Inconclusive</option>
                </select>
              </label>
              <label>
                Operator note
                <textarea value={resolveNote} onChange={(event) => setResolveNote(event.target.value)} rows={3} />
              </label>
              <button
                type="button"
                onClick={() => runDisputeAction(
                  "resolve",
                  () => resolveShowCampaignDispute({
                    campaign: current,
                    token: token ?? "",
                    disputeId: openDispute.id,
                    outcome: resolveOutcome,
                    operatorNote: resolveNote,
                  }),
                  "Dispute resolved.",
                )}
                disabled={!isAuthenticated || busy}
              >
                {pending === "resolve" ? "Resolving..." : "Resolve dispute"}
              </button>
            </div>
          ) : (
            <>
              <p className="show-detail__operator-hint">
                {canInitiateDispute
                  ? "Flag a problem between booking confirmation and final release. Resolution is audited and does not move funds — release stays gated by the contract time-lock."
                  : "Disputes can be raised only between booking confirmation and final fund release."}
              </p>
              <label>
                Reason
                <textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} rows={3} />
              </label>
              <button
                type="button"
                onClick={() => runDisputeAction(
                  "dispute",
                  () => initiateShowCampaignDispute({
                    campaign: current,
                    token: token ?? "",
                    reason: disputeReason,
                  }),
                  "Dispute raised.",
                )}
                disabled={!isAuthenticated || busy || !canInitiateDispute}
              >
                {pending === "dispute" ? "Raising..." : "Raise dispute"}
              </button>
            </>
          )}
          {disputes.length > 0 ? (
            <ul className="show-detail__operator-dispute-history">
              {disputes.map((dispute) => (
                <li key={dispute.id}>
                  <span>
                    {formatStatus(dispute.status)}
                    {dispute.outcome ? ` · ${formatStatus(dispute.outcome)}` : ""}
                  </span>
                  {dispute.operatorNote ? <em>{dispute.operatorNote}</em> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>
      </div>

      {notice ? <p className="show-detail__operator-notice" role="status">{notice}</p> : null}
      {error ? <p className="show-detail__operator-error" role="alert">{error}</p> : null}

      <ConfirmDialog
        isOpen={confirmCancelOpen}
        title="Cancel Campaign"
        message="This moves the campaign and submitted pledges toward refunds. Use it only when the cancellation evidence is ready."
        confirmLabel={pending === "cancel" ? "Cancelling..." : "Cancel campaign"}
        variant="danger"
        onCancel={() => setConfirmCancelOpen(false)}
        onConfirm={async () => {
          setConfirmCancelOpen(false);
          await runAction(
            "cancel",
            () => cancelShowCampaign({
              campaign: current,
              token: token ?? "",
              reason,
              evidenceBundleId: lifecycleEvidenceBundleId,
            }),
            "Campaign cancelled and refunds opened.",
          );
        }}
      />
    </details>
  );
}
