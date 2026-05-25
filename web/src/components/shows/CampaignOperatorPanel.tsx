"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  activateShowCampaign,
  approveShowCampaignAuthority,
  cancelShowCampaign,
  confirmShowCampaignBooking,
  confirmShowCampaignFulfillment,
  type Campaign,
} from "../../lib/shows";

type ActionKey = "authority" | "activate" | "cancel" | "booking" | "fulfillment";

const AUTHORIZED_STATUSES = ["artist_authorized", "trusted_source_authorized"];

function formatStatus(value?: string | null) {
  return value ? value.replaceAll("_", " ") : "not set";
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
    ],
    [current],
  );

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

  return (
    <section className="show-detail__operator-panel" aria-label="Campaign operations">
      <div className="show-detail__operator-header">
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
      </div>

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
      </div>

      {notice ? <p className="show-detail__operator-notice">{notice}</p> : null}
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
    </section>
  );
}
