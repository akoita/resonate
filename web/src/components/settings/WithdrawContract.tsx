"use client";

import { useEffect, useState } from "react";
import {
  getWithdrawalState,
  submitWithdrawal,
  type ContractWithdrawalView,
  type WithdrawableContract,
  type WithdrawalLabels,
  type WithdrawalState,
} from "../../lib/api";
import { formatMoney, type BillingCurrency } from "../../lib/billingCurrency";
import { Button } from "../ui/Button";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

/**
 * #2594: the online withdrawal function (Directive 2023/2673). A "Withdraw
 * from contract" entry shown only while a right to withdraw exists, then a
 * short statement form (who, which contract, where the confirmation goes),
 * then a separate confirmation step with one bare button. Every label comes
 * from the server (`GET /billing/withdrawals`), so an operator can localise
 * them in one place; nothing here is pre-filled or pre-ticked.
 */

export type WithdrawStep = "closed" | "form" | "confirm" | "done";

function money(cents: number, currency: string): string {
  return formatMoney(cents, (currency === "eur" ? "eur" : "usd") as BillingCurrency);
}

function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

const REFUND_STATUS: Record<string, string> = {
  pending: "refund starting",
  refunded: "refund sent to your card",
  failed: "refund being retried",
  not_needed: "nothing to refund",
};

export function refundLine(labels: WithdrawalLabels, contract: WithdrawableContract): string {
  const template = contract.contract === "artist_pro" ? labels.refundArtistPro : labels.refundCreditPack;
  return template.replace("{refund}", money(contract.refundCents, contract.currency));
}

export type WithdrawContractViewProps = {
  state: WithdrawalState;
  step: WithdrawStep;
  name: string;
  selected: string | null;
  busy: boolean;
  onOpen: () => void;
  onNameChange: (name: string) => void;
  onSelect: (subjectId: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onConfirm: () => void;
};

/** Presentational, so each step can be asserted without a session. */
export function WithdrawContractView({
  state,
  step,
  name,
  selected,
  busy,
  onOpen,
  onNameChange,
  onSelect,
  onContinue,
  onBack,
  onConfirm,
}: WithdrawContractViewProps) {
  const { labels, contracts, withdrawals } = state;
  const chosen = contracts.find((c) => c.subjectId === selected) ?? null;
  if (contracts.length === 0 && withdrawals.length === 0 && step !== "done") return null;

  return (
    <div className="withdraw-contract" aria-labelledby="withdraw-contract-heading">
      <h4 id="withdraw-contract-heading" className="withdraw-contract-title">
        {labels.sectionTitle}
      </h4>

      {step === "done" ? (
        <div className="withdraw-contract-done" role="status">
          <p>
            <strong>{labels.doneTitle}</strong> {labels.doneBody}
          </p>
        </div>
      ) : null}

      {contracts.length > 0 && step === "closed" ? (
        <>
          <p className="usage-muted-note">{labels.sectionIntro}</p>
          <ul className="withdraw-contract-list">
            {contracts.map((contract) => (
              <li key={contract.subjectId}>
                {contract.label}, bought {day(contract.boughtAt)}: you can withdraw until {day(contract.rightEndsAt)}.
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={onOpen}>
            {labels.entryButton}
          </Button>
        </>
      ) : null}

      {step === "form" ? (
        <form
          className="withdraw-contract-form"
          aria-label={labels.formTitle}
          onSubmit={(event) => {
            event.preventDefault();
            onContinue();
          }}
        >
          <p className="withdraw-contract-form-title">{labels.formTitle}</p>
          <label className="withdraw-contract-field">
            <span>{labels.nameLabel}</span>
            <input
              className="ui-input"
              type="text"
              name="name"
              autoComplete="name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <fieldset className="withdraw-contract-field">
            <legend>{labels.contractLabel}</legend>
            {contracts.map((contract) => (
              <label key={contract.subjectId} className="withdraw-contract-choice">
                <input
                  type="radio"
                  name="contract"
                  required
                  value={contract.subjectId}
                  checked={selected === contract.subjectId}
                  onChange={() => onSelect(contract.subjectId)}
                />
                <span>{contract.label}</span>
              </label>
            ))}
          </fieldset>
          {chosen ? <p className="usage-muted-note">{refundLine(labels, chosen)}</p> : null}
          <div className="withdraw-contract-field">
            <span>{labels.confirmationLabel}</span>
            <p className="usage-muted-note">
              {state.confirmationEmail
                ? labels.confirmationToEmail.replace("{email}", state.confirmationEmail)
                : labels.confirmationToNotices}
            </p>
          </div>
          <div className="plan-billing-actions">
            <Button type="submit" disabled={!name.trim() || !chosen}>
              {labels.continueButton}
            </Button>
            <Button type="button" variant="ghost" onClick={onBack}>
              {labels.cancelButton}
            </Button>
          </div>
          <p className="usage-muted-note">{labels.fallback}</p>
        </form>
      ) : null}

      {step === "confirm" ? (
        <div className="withdraw-contract-confirm">
          <Button onClick={onConfirm} disabled={busy}>
            {labels.confirmButton}
          </Button>
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            {labels.cancelButton}
          </Button>
        </div>
      ) : null}

      {withdrawals.length > 0 ? (
        <ul className="withdraw-contract-list" aria-label="Your withdrawals">
          {withdrawals.map((w: ContractWithdrawalView) => (
            <li key={w.id}>
              Withdrew from {w.label} on {day(w.withdrawnAt)}: {money(w.refundCents, w.currency)},{" "}
              {REFUND_STATUS[w.refundStatus] ?? w.refundStatus}.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Loads the state and runs the steps. Renders nothing while there is nothing to show. */
export function WithdrawContractSection({
  token,
  addToast,
  refreshKey,
  onWithdrawn,
}: {
  token: string | null | undefined;
  addToast: ToastFn;
  refreshKey?: number;
  onWithdrawn?: () => void;
}) {
  const [state, setState] = useState<WithdrawalState | null>(null);
  const [step, setStep] = useState<WithdrawStep>("closed");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      setState(await getWithdrawalState(token));
    } catch {
      // The section stays hidden; the written route in the refund policy still works.
      setState(null);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token and refresh are the reload boundary.
  }, [token, refreshKey]);

  if (!state) return null;

  const reset = () => {
    setStep("closed");
    setName("");
    setSelected(null);
  };

  const confirm = async () => {
    const contract = state.contracts.find((c) => c.subjectId === selected);
    if (!token || !contract || busy) return;
    setBusy(true);
    try {
      await submitWithdrawal(token, { contract: contract.contract, subjectId: contract.subjectId, name: name.trim() });
      setName("");
      setSelected(null);
      setStep("done");
      await load();
      onWithdrawn?.();
    } catch {
      addToast({
        type: "error",
        title: "Withdrawal not recorded",
        message: `Something went wrong, so nothing was recorded. Please try again. ${state.labels.fallback}`,
      });
      setStep("form");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WithdrawContractView
      state={state}
      step={step}
      name={name}
      selected={selected}
      busy={busy}
      onOpen={() => setStep("form")}
      onNameChange={setName}
      onSelect={setSelected}
      onContinue={() => setStep("confirm")}
      onBack={reset}
      onConfirm={() => void confirm()}
    />
  );
}
