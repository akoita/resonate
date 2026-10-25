"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  getBillingState,
  openBillingPortal,
  startSubscriptionCheckout,
  type BillingInterval,
  type BillingState,
} from "../../lib/api";
import { Button } from "../ui/Button";

type ToastFn = (toast: {
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}) => void;

/** What the Plan section offers, from the subscription state (#2407). */
export type PlanBillingKind =
  | "loading"
  | "error"
  | "unavailable"
  | "granted"
  | "subscribe"
  | "active"
  | "ending"
  | "past_due"
  | "unpaid";

export const ARTIST_PRO_PRICE_HEADLINE = "Artist Pro — $14.99/month or yearly";

const INTERVAL_LABEL: Record<BillingInterval, string> = { month: "Monthly", year: "Yearly" };

export function formatBillingDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function planBillingKind(
  billing: BillingState | null,
  options: { error?: boolean; now?: number } = {},
): PlanBillingKind {
  if (!billing) return options.error ? "error" : "loading";
  const now = options.now ?? Date.now();
  const sub = billing.subscription;
  if (sub) {
    if (sub.status === "past_due") return "past_due";
    if (sub.status === "unpaid") return "unpaid";
    if (sub.status === "active" || sub.status === "trialing") return sub.cancelAtPeriodEnd ? "ending" : "active";
    const end = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : NaN;
    if (sub.status === "canceled" && sub.cancelAtPeriodEnd && end > now) return "ending";
  }
  if (billing.plan.plan === "pro" && (billing.plan.source === "operator_grant" || billing.plan.source === "promo")) {
    return "granted";
  }
  if (!billing.available) return "unavailable";
  return "subscribe";
}

/** The `?billing=` return from Stripe Checkout or the Portal, read once. */
export function readBillingReturn(search: string): "success" | "cancel" | "portal" | null {
  const value = new URLSearchParams(search).get("billing");
  return value === "success" || value === "cancel" || value === "portal" ? value : null;
}

export type PlanBillingViewProps = {
  billing: BillingState | null;
  kind: PlanBillingKind;
  /** The interval whose consent step is open, or null before a choice. */
  chosenInterval: BillingInterval | null;
  acknowledged: boolean;
  busy?: boolean;
  /** A one-line status after returning from Stripe. */
  returnNotice?: string | null;
  onChoose?: (interval: BillingInterval) => void;
  onAcknowledge?: (value: boolean) => void;
  onBack?: () => void;
  onContinue?: () => void;
  onManage?: () => void;
  onRetry?: () => void;
};

/**
 * The subscription part of Settings → Usage & Billing → Plan (#2407). Pure, so
 * each state renders with `renderToStaticMarkup`; {@link PlanBillingSection}
 * owns the fetching and the redirects.
 */
export function PlanBillingView({
  billing,
  kind,
  chosenInterval,
  acknowledged,
  busy = false,
  returnNotice,
  onChoose,
  onAcknowledge,
  onBack,
  onContinue,
  onManage,
  onRetry,
}: PlanBillingViewProps) {
  const sub = billing?.subscription ?? null;
  const canManage = Boolean(billing?.available && billing.hasBillingAccount);
  const periodEnd = formatBillingDate(sub?.currentPeriodEnd);
  const manageButton = canManage ? (
    <Button variant="ghost" onClick={onManage} disabled={busy}>
      {busy ? "Opening…" : kind === "past_due" || kind === "unpaid" ? "Update your card" : "Manage billing"}
    </Button>
  ) : null;

  return (
    <div className="plan-billing">
      {returnNotice ? (
        <p className="plan-billing-return" role="status">
          {returnNotice}
        </p>
      ) : null}

      {billing?.available && billing.testMode && kind !== "granted" ? (
        <p className="plan-billing-test-mode">
          <strong>Test mode.</strong> Subscriptions run in Stripe&rsquo;s test environment: no real card is
          charged.
        </p>
      ) : null}

      {kind === "loading" ? <p className="usage-muted-note">Loading subscription…</p> : null}

      {kind === "error" ? (
        <div className="usage-error" role="alert">
          <p>Could not load your subscription.</p>
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {kind === "unavailable" ? (
        <p className="usage-muted-note">
          {ARTIST_PRO_PRICE_HEADLINE}. Subscriptions are not available on this server yet.
        </p>
      ) : null}

      {kind === "active" && sub ? (
        <div className="plan-billing-status">
          <p>
            <strong>Artist Pro · {INTERVAL_LABEL[sub.interval]}</strong> — active.
            {periodEnd ? ` Renews on ${periodEnd}.` : null}
          </p>
          {manageButton}
        </div>
      ) : null}

      {kind === "ending" && sub ? (
        <div className="plan-billing-status">
          <p>
            <strong>Artist Pro · {INTERVAL_LABEL[sub.interval]}</strong> — canceled.
            {periodEnd ? ` Pro stays on until ${periodEnd}, and nothing more is charged.` : null}
          </p>
          {manageButton}
        </div>
      ) : null}

      {kind === "past_due" && sub ? (
        <div className="plan-billing-alert" role="alert">
          <p>
            <strong>Your last payment failed — update your card.</strong>{" "}
            {formatBillingDate(sub.graceEndsAt)
              ? `Artist Pro stays on until ${formatBillingDate(sub.graceEndsAt)}; after that your plan returns to Free. Nothing is deleted.`
              : "Artist Pro stays on for 7 days; after that your plan returns to Free. Nothing is deleted."}
          </p>
          {manageButton}
        </div>
      ) : null}

      {kind === "unpaid" ? (
        <div className="plan-billing-alert" role="alert">
          <p>
            <strong>Your payment could not be collected, so Artist Pro has ended.</strong> Update your card in
            Manage billing to start it again. Nothing was deleted.
          </p>
          {manageButton}
        </div>
      ) : null}

      {kind === "subscribe" && billing ? (
        <div className="plan-billing-offer">
          <p className="plan-billing-headline">
            <strong>{ARTIST_PRO_PRICE_HEADLINE}</strong>
          </p>
          <p className="usage-muted-note">
            One plan for artists, producers and DJs. Pro tools are free for everyone for now, so subscribing does not
            change what you can do yet. The exact price, with any tax, is shown on Stripe&rsquo;s secure checkout page
            before you pay.
          </p>

          {!billing.contactEmailConfirmed ? (
            <p className="plan-billing-email-gate">
              Subscribing needs a confirmed contact email: your receipts are sent there.{" "}
              <a href="/settings?section=email">Add a contact email</a>
            </p>
          ) : chosenInterval === null ? (
            <div className="plan-billing-actions">
              <Button onClick={() => onChoose?.("month")}>Subscribe monthly</Button>
              <Button variant="ghost" onClick={() => onChoose?.("year")}>
                Subscribe yearly
              </Button>
            </div>
          ) : (
            <fieldset className="plan-billing-consent">
              <legend>{billing.consent.heading}</legend>
              <p>
                You chose <strong>Artist Pro · {INTERVAL_LABEL[chosenInterval]}</strong>.
              </p>
              <p>{billing.consent.intro}</p>
              <label className="plan-billing-consent-check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => onAcknowledge?.(event.target.checked)}
                />
                <span>{billing.consent.acknowledgement}</span>
              </label>
              <p className="usage-muted-note">{billing.consent.cancellation}</p>
              <p className="usage-muted-note">{billing.consent.confirmation}</p>
              {billing.consent.reviewStatus === "for_legal_review_before_production" ? (
                <p className="usage-muted-note">Draft wording, for legal review before production.</p>
              ) : null}
              <div className="plan-billing-actions">
                <Button onClick={onContinue} disabled={!acknowledged || busy}>
                  {busy ? "Opening checkout…" : "Continue to secure checkout"}
                </Button>
                <Button variant="ghost" onClick={onBack} disabled={busy}>
                  Back
                </Button>
              </div>
              {!acknowledged ? (
                <p className="usage-muted-note">Tick the box to continue. Nothing is ticked for you.</p>
              ) : null}
            </fieldset>
          )}
        </div>
      ) : null}
    </div>
  );
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const details = error.details as { code?: unknown } | undefined;
  return typeof details?.code === "string" ? details.code : null;
}

const RETURN_NOTICES = {
  success: "Thanks! Stripe is confirming your subscription; this can take a few seconds.",
  cancel: "Checkout canceled. Nothing was charged.",
  portal: null,
} as const;

/** How often, and how many times, the state is re-read after a successful checkout. */
const CONFIRM_POLL_MS = 3000;
const CONFIRM_POLL_TRIES = 5;

/**
 * Container for {@link PlanBillingView}: reads `GET /billing/subscription`,
 * handles the `?billing=success|cancel|portal` return (refreshing until the
 * webhook lands), and redirects to Stripe Checkout or the Customer Portal.
 */
export function PlanBillingSection({
  token,
  addToast,
  onPlanChanged,
}: {
  token: string | null | undefined;
  addToast: ToastFn;
  onPlanChanged?: () => void;
}) {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [error, setError] = useState(false);
  const [chosenInterval, setChosenInterval] = useState<BillingInterval | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) return null;
    try {
      const next = await getBillingState(token);
      setBilling(next);
      setError(false);
      return next;
    } catch {
      setError(true);
      return null;
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // The return from Stripe: show the outcome once, then drop the parameter.
  useEffect(() => {
    if (!token || typeof window === "undefined") return;
    const result = readBillingReturn(window.location.search);
    if (!result) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("billing");
    window.history.replaceState(null, "", url.toString());
    setReturnNotice(RETURN_NOTICES[result]);
    if (result === "cancel") return;
    let tries = 0;
    const poll = async () => {
      tries += 1;
      const next = await load();
      onPlanChanged?.();
      const settled = next?.subscription && next.subscription.status !== "incomplete";
      if (result === "success" && settled) {
        setReturnNotice("Your Artist Pro subscription is confirmed.");
        return;
      }
      if (result === "success" && tries < CONFIRM_POLL_TRIES) {
        pollRef.current = setTimeout(poll, CONFIRM_POLL_MS);
      } else if (result === "success") {
        setReturnNotice("Stripe has not confirmed your subscription yet. Refresh in a minute to see it.");
      }
    };
    void poll();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the return once per token.
  }, [token]);

  const handleContinue = async () => {
    if (!token || !billing || !chosenInterval || !acknowledged || busy) return;
    setBusy(true);
    try {
      const { url } = await startSubscriptionCheckout(token, {
        interval: chosenInterval,
        acknowledgedImmediateStart: true,
        textVersion: billing.consent.version,
      });
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      const code = errorCode(err);
      const message =
        code === "contact_email_required"
          ? "Confirm a contact email in Settings → Email first."
          : code === "consent_text_outdated"
            ? "The subscription terms changed. Read them again and confirm."
            : code === "already_subscribed"
              ? "You already have Artist Pro. Use Manage billing."
              : code === "billing_unavailable"
                ? "Subscriptions are not available on this server yet."
                : "Could not open the checkout. Please try again.";
      addToast({ type: "error", title: "Checkout not started", message });
      setAcknowledged(false);
      void load();
    }
  };

  const handleManage = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      const { url } = await openBillingPortal(token);
      window.location.assign(url);
    } catch {
      setBusy(false);
      addToast({ type: "error", title: "Billing not opened", message: "Could not open Manage billing. Please try again." });
    }
  };

  return (
    <PlanBillingView
      billing={billing}
      kind={planBillingKind(billing, { error })}
      chosenInterval={chosenInterval}
      acknowledged={acknowledged}
      busy={busy}
      returnNotice={returnNotice}
      onChoose={(interval) => {
        setChosenInterval(interval);
        setAcknowledged(false);
      }}
      onAcknowledge={setAcknowledged}
      onBack={() => {
        setChosenInterval(null);
        setAcknowledged(false);
      }}
      onContinue={handleContinue}
      onManage={handleManage}
      onRetry={() => void load()}
    />
  );
}
