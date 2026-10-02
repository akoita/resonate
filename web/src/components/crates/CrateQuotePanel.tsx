"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { sendBatchContractTransactions } from "../../hooks/useContracts";
import { createCrateQuote, settleCrateQuote } from "../../lib/api";
import { getContractAddresses } from "../../lib/contracts";
import {
  choicesFromQuote,
  clearPendingSettle,
  crateQuoteErrorMessage,
  hasReceipts,
  isQuoteExpired,
  itemPriceText,
  lineRequestsFromChoices,
  overBudgetText,
  quoteBlocker,
  quoteBlockerText,
  quotedStems,
  readPendingSettle,
  resolveBuyerAddress,
  storePendingSettle,
  titleCase,
  totalsForStems,
  withStemToggled,
  withTier,
  type LineChoice,
} from "../../lib/crateQuote";
import { runCratePreflight, type PreflightDrop } from "../../lib/crateQuotePreflight";
import {
  runCrateQuotePurchase,
  settleWithBackoff,
  type PurchaseOutcome,
  type PurchaseStage,
  type SettlementOutcome,
} from "../../lib/crateQuotePurchase";
import type {
  CrateItemDto,
  CrateLicenseType,
  CrateQuote,
  CrateStemType,
} from "../../lib/crates";
import type { CrateBatchLine } from "../../lib/onchainCheckout";
import {
  CrateDroppedList,
  CrateQuoteReceipts,
  CrateQuoteView,
  QuoteTotals,
  TransactionLink,
} from "./CrateQuoteView";
import "../../styles/crates.css";

type Busy = "quoting" | "checking" | "deciding" | "signing" | "settling" | null;

type Sent = {
  hash: string;
  dropped: PreflightDrop[];
  /** "pending": no receipt yet, retry. "rejected": the backend refused it for good. */
  state: "pending" | "rejected";
  message: string | null;
};

const PROGRESS_TEXT: Record<Exclude<Busy, null>, string> = {
  quoting: "Getting your quote from the network…",
  checking: "Checking every stem against the network…",
  deciding: "Some stems cannot be bought. Choose how to go on.",
  signing: "Waiting for your signature…",
  settling: "Confirming your purchase…",
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type CrateQuotePanelProps = {
  crateId: string;
  /** The saved crate's lines, for the tiers and stems of each line. */
  items: CrateItemDto[];
  /** The crate's most recent quote (any status), or null. */
  latestQuote: CrateQuote | null;
  /** A quote prices the saved crate, so unsaved edits must be saved first. */
  hasUnsavedChanges: boolean;
  /** Called after a purchase settled, so the page can refresh the crate. */
  onPurchaseFinished: () => void;
};

/**
 * Quote, approve and buy a crate with one signature (#1964).
 *
 * Nothing here moves money on its own: "Approve and buy" opens a confirm step
 * that lists exactly what will be bought, the chain is checked, the DJ confirms
 * again if any line was left out, and only then is one batch signed (see
 * `crateQuotePurchase.ts` for the guarantees).
 */
export function CrateQuotePanel({
  crateId,
  items,
  latestQuote,
  hasUnsavedChanges,
  onPurchaseFinished,
}: CrateQuotePanelProps) {
  const { token, address, kernelAccount, smartAccountAddress } = useAuth();
  const { publicClient, chainId } = useZeroDev();
  const buyer = resolveBuyerAddress({
    kernelAddress: (kernelAccount?.address as string | undefined) ?? null,
    smartAccountAddress,
    address,
  });
  const marketplace = useMemo(() => {
    try {
      return getContractAddresses(chainId).marketplace;
    } catch {
      return null;
    }
  }, [chainId]);

  const [quote, setQuote] = useState<CrateQuote | null>(latestQuote);
  const [choices, setChoices] = useState<Map<string, LineChoice>>(() =>
    latestQuote ? choicesFromQuote(latestQuote) : new Map(),
  );
  const [busy, setBusy] = useState<Busy>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState<PreflightDrop[] | null>(null);
  const [decision, setDecision] = useState<{ dropped: PreflightDrop[]; keep: CrateBatchLine[] } | null>(
    null,
  );
  // A transaction sent for the reopened quote before the page closed: finish
  // settling it, never offer the same stems again.
  const [sent, setSent] = useState<Sent | null>(() => {
    if (!latestQuote || latestQuote.status !== "open") return null;
    const pending = readPendingSettle(latestQuote.id);
    return pending
      ? { hash: pending.transactionHash, dropped: pending.dropped, state: "pending", message: null }
      : null;
  });
  const [nowMs, setNowMs] = useState(() => Date.now());

  const decisionRef = useRef<((proceed: boolean) => void) | null>(null);
  const runningRef = useRef(false);
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      decisionRef.current?.(false);
      decisionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (quote && hasReceipts(quote)) clearPendingSettle(quote.id);
  }, [quote]);

  const live = quote !== null && quote.status === "open";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  const requote = useCallback(
    async (lines?: ReturnType<typeof lineRequestsFromChoices>) => {
      if (!token || !buyer || runningRef.current) return;
      const seq = seqRef.current + 1;
      seqRef.current = seq;
      setBusy("quoting");
      setError(null);
      setNotice(null);
      setLeftOut(null);
      setConfirming(false);
      setSent(null);
      try {
        const next = await createCrateQuote(token, crateId, {
          buyerAddress: buyer,
          ...(lines ? { lines } : {}),
        });
        if (!mountedRef.current || seq !== seqRef.current) return;
        setQuote(next);
        setChoices(choicesFromQuote(next));
        setNowMs(Date.now());
      } catch (err) {
        if (!mountedRef.current || seq !== seqRef.current) return;
        setError(crateQuoteErrorMessage(err, "Could not get a quote. Please try again."));
      } finally {
        if (mountedRef.current && seq === seqRef.current) setBusy(null);
      }
    },
    [buyer, crateId, token],
  );

  const onTierChange = (trackId: string, tier: CrateLicenseType) => {
    if (!quote) return;
    void requote(lineRequestsFromChoices(quote, withTier(choices, trackId, tier)));
  };

  const onStemToggle = (trackId: string, stem: CrateStemType) => {
    if (!quote) return;
    void requote(lineRequestsFromChoices(quote, withStemToggled(choices, trackId, stem)));
  };

  const applySettlement = useCallback(
    (settlement: SettlementOutcome, hash: string, dropped: PreflightDrop[], quoteId: string) => {
      if (!mountedRef.current) return;
      if (settlement.kind === "final") {
        setQuote(settlement.quote);
        setSent(null);
        onPurchaseFinished();
        return;
      }
      if (settlement.kind === "pending") {
        if (settlement.quote) setQuote(settlement.quote);
        setSent({ hash, dropped, state: "pending", message: null });
        return;
      }
      clearPendingSettle(quoteId);
      setSent({
        hash,
        dropped,
        state: "rejected",
        message: crateQuoteErrorMessage(settlement.error, "We could not record your purchase."),
      });
    },
    [onPurchaseFinished],
  );

  const handleOutcome = useCallback(
    (outcome: PurchaseOutcome, quoteId: string) => {
      if (!mountedRef.current) return;
      switch (outcome.kind) {
        case "blocked":
          setError(quoteBlockerText(outcome.blocker));
          break;
        case "nothing_to_buy":
          setLeftOut(outcome.dropped);
          setNotice(
            "None of these stems can be bought right now. Nothing was charged. Get a new quote to see what is still for sale.",
          );
          break;
        case "cancelled":
          setNotice("Cancelled. Nothing was charged. Your quote is still open.");
          break;
        case "not_sent":
          setError(outcome.message);
          break;
        case "sent":
          applySettlement(outcome.settlement, outcome.transactionHash, outcome.dropped, quoteId);
          break;
      }
    },
    [applySettlement],
  );

  const onStage = (stage: PurchaseStage) => {
    if (!mountedRef.current) return;
    setBusy(
      stage === "checking"
        ? "checking"
        : stage === "confirming_drops"
          ? "deciding"
          : stage === "signing"
            ? "signing"
            : "settling",
    );
  };

  const approveAndBuy = async () => {
    if (!quote || !token || !buyer || runningRef.current) return;
    runningRef.current = true;
    setConfirming(false);
    setError(null);
    setNotice(null);
    setLeftOut(null);
    setSent(null);
    setBusy("checking");
    try {
      const outcome = await runCrateQuotePurchase({
        quote,
        buyerAddress: buyer,
        chainId,
        marketplaceAddress: marketplace,
        now: Date.now,
        preflight: (lines) =>
          runCratePreflight({
            publicClient,
            marketplaceAddress: quote.marketplaceAddress as Address,
            buyer: buyer as Address,
            lines,
          }),
        confirmDropped: (dropped, keep) =>
          new Promise<boolean>((resolve) => {
            decisionRef.current = resolve;
            setDecision({ dropped, keep });
          }),
        send: (plan) =>
          sendBatchContractTransactions(
            publicClient,
            chainId,
            plan.calls,
            buyer as Address,
            kernelAccount,
          ),
        settle: (body) => settleCrateQuote(token, crateId, quote.id, body),
        sleep,
        onStage,
        onSent: (transactionHash, dropped) =>
          storePendingSettle(quote.id, { transactionHash, dropped }),
        isCancelled: () => !mountedRef.current,
      });
      handleOutcome(outcome, quote.id);
    } catch {
      if (mountedRef.current) {
        setError(
          "Something went wrong. If your wallet shows a charge, check your wallet activity before buying again.",
        );
      }
    } finally {
      runningRef.current = false;
      decisionRef.current = null;
      if (mountedRef.current) {
        setDecision(null);
        setBusy(null);
      }
    }
  };

  const answerDecision = (proceed: boolean) => {
    const resolve = decisionRef.current;
    decisionRef.current = null;
    setDecision(null);
    resolve?.(proceed);
  };

  const pendingHash = sent?.state === "pending"
    ? sent.hash
    : quote?.status === "submitted"
      ? quote.transactionHash
      : null;

  const retrySettle = async () => {
    if (!quote || !token || !pendingHash || runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setBusy("settling");
    const dropped = sent?.dropped ?? [];
    try {
      const settlement = await settleWithBackoff({
        settle: () =>
          settleCrateQuote(token, crateId, quote.id, { transactionHash: pendingHash, dropped }),
        sleep,
        isCancelled: () => !mountedRef.current,
      });
      applySettlement(settlement, pendingHash, dropped, quote.id);
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  };

  const expired = quote !== null && isQuoteExpired(quote, nowMs);
  const blocker = quote
    ? quoteBlocker({ quote, buyerAddress: buyer, chainId, marketplaceAddress: marketplace, nowMs })
    : null;
  const stems = quote ? quotedStems(quote) : [];
  const canQuote =
    Boolean(token && buyer) && items.length > 0 && !hasUnsavedChanges && busy === null;
  const quoteHint = !token || !buyer
    ? "Sign in to get a quote."
    : items.length === 0
      ? "Add a line to this crate to get a quote."
      : hasUnsavedChanges
        ? "Save your changes first. A quote prices the crate as it is saved."
        : null;
  // Once a transaction was sent for a quote, that quote can never be approved
  // again: a second approval would buy the same stems twice.
  const wasSent = sent !== null;
  const open = quote !== null && quote.status === "open" && !wasSent;
  const submitted = quote !== null && quote.status === "submitted";
  const finished = quote !== null && hasReceipts(quote);
  const budget = quote ? overBudgetText(quote) : null;

  const newQuoteButton = (primary: boolean) => (
    <button
      type="button"
      className={`crates-btn ${primary ? "crates-btn--primary" : ""}`}
      onClick={() => void requote()}
      disabled={!canQuote}
    >
      {quote === null ? "Get a quote" : "Get a new quote"}
    </button>
  );

  return (
    <section className="crates-panel crates-quote-panel" aria-labelledby="crate-quote-heading">
      <h2 id="crate-quote-heading">Buy this crate</h2>
      <p className="crates-hint">
        Get a quote, check it, and buy every stem with one signature. You approve the exact
        stems and total first. A stem that cannot be bought is left out and never charged.
      </p>

      <p className="crates-hint" role="status" aria-live="polite" data-testid="crate-quote-progress">
        {busy ? PROGRESS_TEXT[busy] : ""}
      </p>
      {error ? (
        <p className="crates-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="crates-notice">{notice}</p> : null}
      {leftOut && quote ? <CrateDroppedList quote={quote} dropped={leftOut} /> : null}

      {quote === null ? (
        <div className="crates-row">
          {newQuoteButton(true)}
          {quoteHint ? <span className="crates-hint">{quoteHint}</span> : null}
        </div>
      ) : null}

      {quote !== null && (open || submitted || finished) ? (
        <h3 className="crates-quote-title">{open ? "Your quote" : "Your last purchase"}</h3>
      ) : null}

      {open && quote ? (
        <>
          <CrateQuoteView
            quote={quote}
            crateItems={items}
            choices={choices}
            nowMs={nowMs}
            disabled={busy !== null || confirming}
            onTierChange={onTierChange}
            onStemToggle={onStemToggle}
          />

          {blocker && blocker !== "expired" ? (
            <p className="crates-error" role="status">
              {quoteBlockerText(blocker)}
            </p>
          ) : null}

          {confirming ? (
            <div className="crates-quote-confirm" role="group" aria-labelledby="crate-quote-confirm-heading">
              <h3 id="crate-quote-confirm-heading">Confirm your purchase</h3>
              <p>
                You are about to buy {stems.length} {stems.length === 1 ? "stem" : "stems"}:
              </p>
              <ul className="crates-quote-confirm-list">
                {stems.map(({ line, item }) => (
                  <li key={item.quoteLineId}>
                    {line.title?.trim() || "Untitled track"}: {titleCase(item.stemType)} (
                    {titleCase(line.licenseType)}) for {itemPriceText(item) ?? "an unknown price"}
                  </li>
                ))}
              </ul>
              <QuoteTotals quote={quote} label="Total to pay" />
              {budget ? <p className="crates-error">{budget}</p> : null}
              <p className="crates-hint">
                You sign once. If a stem can no longer be bought, you will be told before anything
                is charged.
              </p>
              <div className="crates-row">
                <button
                  type="button"
                  className="crates-btn crates-btn--primary"
                  onClick={() => void approveAndBuy()}
                  disabled={busy !== null || blocker !== null}
                >
                  Confirm and sign
                </button>
                <button
                  type="button"
                  className="crates-btn"
                  onClick={() => setConfirming(false)}
                  disabled={busy !== null}
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {decision ? (
            <div className="crates-quote-confirm" role="group" aria-labelledby="crate-quote-drop-heading">
              <h3 id="crate-quote-drop-heading">Some stems cannot be bought right now</h3>
              <p>These were left out and will not be charged:</p>
              <CrateDroppedList quote={quote} dropped={decision.dropped} />
              <p>
                Buy the other {decision.keep.length} {decision.keep.length === 1 ? "stem" : "stems"} for{" "}
                {totalsForStems(quote, decision.keep.map((line) => line.quoteLineId)).join(" + ")}?
              </p>
              <div className="crates-row">
                <button
                  type="button"
                  className="crates-btn crates-btn--primary"
                  onClick={() => answerDecision(true)}
                >
                  Buy the rest
                </button>
                <button type="button" className="crates-btn" onClick={() => answerDecision(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {!confirming && !decision ? (
            <div className="crates-row">
              {expired ? (
                newQuoteButton(true)
              ) : (
                <>
                  <button
                    type="button"
                    className="crates-btn crates-btn--primary"
                    onClick={() => setConfirming(true)}
                    disabled={busy !== null || blocker !== null || stems.length === 0}
                  >
                    Approve and buy
                  </button>
                  {newQuoteButton(false)}
                </>
              )}
              {quoteHint && !canQuote && busy === null ? (
                <span className="crates-hint">{quoteHint}</span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {wasSent && sent ? (
        <div className="crates-quote-sent" role="group" aria-label="Your purchase was sent">
          {sent.state === "pending" ? (
            <p>
              Your purchase was sent and is still confirming. Nothing more is needed from you.{" "}
              <TransactionLink hash={sent.hash} />
            </p>
          ) : (
            <p className="crates-error" role="alert">
              Your purchase was sent, but we could not record it. {sent.message}{" "}
              <TransactionLink hash={sent.hash} />
            </p>
          )}
          <div className="crates-row">
            {sent.state === "pending" ? (
              <button
                type="button"
                className="crates-btn crates-btn--primary"
                onClick={() => void retrySettle()}
                disabled={busy !== null || !pendingHash}
              >
                Check again
              </button>
            ) : null}
            {newQuoteButton(false)}
          </div>
        </div>
      ) : null}

      {quote !== null && (submitted || finished) ? (
        <>
          <CrateQuoteReceipts quote={quote} />
          <div className="crates-row">
            {submitted && !wasSent ? (
              <>
                <button
                  type="button"
                  className="crates-btn crates-btn--primary"
                  onClick={() => void retrySettle()}
                  disabled={busy !== null || !pendingHash}
                >
                  Check again
                </button>
                <span className="crates-hint">Still confirming. This can take a minute.</span>
              </>
            ) : null}
            {!wasSent ? newQuoteButton(false) : null}
            {quoteHint && !canQuote && busy === null ? (
              <span className="crates-hint">{quoteHint}</span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
