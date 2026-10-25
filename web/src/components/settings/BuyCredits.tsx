"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ApiRequestError,
  deliverHeldCreditsNow,
  getCreditTopUpState,
  startCreditCheckout,
  type CreditPackId,
  type CreditPurchase,
  type CreditTopUpState,
} from "../../lib/api";
import { formatCents } from "../../lib/usage";
import { DeliveryConsentStep } from "../consent/DeliveryConsentStep";
import {
  INITIAL_DELIVERY_CONSENT,
  isDeliveryConsentComplete,
  type DeliveryConsentState,
} from "../consent/deliveryConsent";
import { Button } from "../ui/Button";

type ToastFn = (toast: {
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}) => void;

/** What the Buy credits block offers (#1422). */
export type BuyCreditsKind = "loading" | "error" | "unavailable" | "buy";

export function buyCreditsKind(state: CreditTopUpState | null, options: { error?: boolean } = {}): BuyCreditsKind {
  if (!state) return options.error ? "error" : "loading";
  return state.available ? "buy" : "unavailable";
}

/** The `?credits=` return from Stripe Checkout (and its Checkout Session id), read once. */
export function readCreditsReturn(
  search: string,
): { result: "success" | "cancel"; sessionId: string | null } | null {
  const params = new URLSearchParams(search);
  const value = params.get("credits");
  if (value !== "success" && value !== "cancel") return null;
  const sessionId = params.get("credits_session");
  return { result: value, sessionId: sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId) ? sessionId : null };
}

/** The purchase a return from Checkout is waiting for, once the webhook has recorded it. */
export function findReturnedPurchase(
  state: CreditTopUpState | null,
  sessionId: string | null,
  returnedAt: number,
): CreditPurchase | null {
  if (!state) return null;
  if (sessionId) return state.purchases.find((purchase) => purchase.checkoutSessionId === sessionId) ?? null;
  // No session id: the newest purchase paid since shortly before the return.
  const latest = state.purchases[0];
  return latest && Date.parse(latest.paidAt) >= returnedAt - 10 * 60 * 1000 ? latest : null;
}

/** The pack the checkout starts on: the server's default ($10). */
export function defaultPackId(state: CreditTopUpState | null): CreditPackId | null {
  if (!state) return null;
  return state.packs.find((pack) => pack.isDefault)?.id ?? state.defaultPackId ?? state.packs[0]?.id ?? null;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** One purchase's status, in the buyer's words. */
export function describeCreditPurchase(purchase: CreditPurchase): string {
  if (purchase.status === "held") {
    const date = formatDate(purchase.heldUntil);
    return date ? `On hold until ${date}` : "On hold for 14 days";
  }
  if (purchase.status === "refunded") return "Refunded";
  if (purchase.status === "needs_review") return "Payment received, under review";
  if (purchase.refundedCreditsCents > 0) {
    return `Added to your balance; ${formatCents(purchase.refundedCreditsCents)} refunded`;
  }
  return "Added to your balance";
}

export type BuyCreditsViewProps = {
  state: CreditTopUpState | null;
  kind: BuyCreditsKind;
  selectedPackId: CreditPackId | null;
  /** True once "Buy" is pressed: the delivery choice is shown before paying. */
  consentOpen: boolean;
  consent: DeliveryConsentState;
  busy?: boolean;
  returnNotice?: string | null;
  /** The held purchase whose "Deliver now" confirmation is open. */
  releaseId?: string | null;
  releaseAcknowledged?: boolean;
  onSelectPack?: (id: CreditPackId) => void;
  onOpenConsent?: () => void;
  onConsentChange?: (next: DeliveryConsentState) => void;
  onBack?: () => void;
  onContinue?: () => void;
  onRetry?: () => void;
  onAskRelease?: (purchaseId: string) => void;
  onReleaseAcknowledge?: (value: boolean) => void;
  onReleaseConfirm?: () => void;
  onReleaseCancel?: () => void;
};

/**
 * Settings → Usage & Billing → Credits → Buy credits (#1422). Pure, so each
 * state renders with `renderToStaticMarkup`; {@link BuyCreditsSection} owns
 * the fetching and the redirect. The $10 pack is preselected (the accepted
 * default); the delivery choice is never preselected.
 */
export function BuyCreditsView({
  state,
  kind,
  selectedPackId,
  consentOpen,
  consent,
  busy = false,
  returnNotice,
  releaseId = null,
  releaseAcknowledged = false,
  onSelectPack,
  onOpenConsent,
  onConsentChange,
  onBack,
  onContinue,
  onRetry,
  onAskRelease,
  onReleaseAcknowledge,
  onReleaseConfirm,
  onReleaseCancel,
}: BuyCreditsViewProps) {
  const groupId = useId();
  const selected = state?.packs.find((pack) => pack.id === selectedPackId) ?? null;
  const consentComplete = isDeliveryConsentComplete(consent);
  const purchases = state?.purchases ?? [];
  const held = purchases.filter((purchase) => purchase.status === "held");

  return (
    <div className="buy-credits" aria-labelledby={`${groupId}-title`}>
      <h4 id={`${groupId}-title`} className="buy-credits-title">
        Buy credits
      </h4>

      {returnNotice ? (
        <p className="plan-billing-return" role="status">
          {returnNotice}
        </p>
      ) : null}

      {state?.available && state.testMode ? (
        <p className="plan-billing-test-mode">
          <strong>Test mode.</strong> Credit purchases run in Stripe&rsquo;s test environment: no real card is charged.
        </p>
      ) : null}

      {kind === "loading" ? <p className="usage-muted-note">Loading credit packs…</p> : null}

      {kind === "error" ? (
        <div className="usage-error" role="alert">
          <p>Could not load the credit packs.</p>
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {kind === "unavailable" ? (
        <p className="usage-muted-note">
          Credit packs of $5, $10 and $25. Buying credits is not available on this server yet.
        </p>
      ) : null}

      {kind === "buy" && state ? (
        <div className="buy-credits-offer">
          <div className="buy-credits-packs" role="radiogroup" aria-label="Credit pack">
            {state.packs.map((pack) => (
              <label key={pack.id} className="buy-credits-pack" data-selected={pack.id === selectedPackId}>
                <input
                  type="radio"
                  name={`${groupId}-pack`}
                  checked={pack.id === selectedPackId}
                  disabled={consentOpen || busy}
                  onChange={() => onSelectPack?.(pack.id)}
                />
                <span className="buy-credits-pack-price">{formatCents(pack.priceCents)}</span>
                <span className="usage-muted-note">{formatCents(pack.creditsCents)} of credits</span>
              </label>
            ))}
          </div>
          <p className="usage-muted-note">
            Prices are before any tax: Stripe&rsquo;s secure checkout page shows the exact amount before you pay.
            Bought credits do not expire.
          </p>

          {!state.contactEmailConfirmed ? (
            <p className="plan-billing-email-gate">
              Buying credits needs a confirmed contact email: your receipts are sent there.{" "}
              <a href="/settings?section=email">Add a contact email</a>
            </p>
          ) : !consentOpen ? (
            <div className="plan-billing-actions">
              <Button onClick={onOpenConsent} disabled={!selected || busy}>
                {selected ? `Buy ${formatCents(selected.priceCents)} of credits` : "Choose a pack"}
              </Button>
            </div>
          ) : (
            <div className="buy-credits-consent">
              {selected ? (
                <p>
                  You chose the <strong>{selected.label}</strong>: {formatCents(selected.creditsCents)} of generation
                  credits.
                </p>
              ) : null}
              <DeliveryConsentStep
                wording={state.consent}
                state={consent}
                onChange={(next) => onConsentChange?.(next)}
                disabled={busy}
              />
              <div className="plan-billing-actions">
                <Button onClick={onContinue} disabled={!consentComplete || !selected || busy}>
                  {busy ? "Opening checkout…" : "Continue to secure checkout"}
                </Button>
                <Button variant="ghost" onClick={onBack} disabled={busy}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {held.length ? (
        <div className="buy-credits-held">
          <p>
            <strong>{formatCents(state?.heldCents ?? 0)} of credits on hold.</strong> You chose to keep your right to
            withdraw, so these arrive in your balance automatically when the 14 days end.
          </p>
          <ul className="buy-credits-list">
            {held.map((purchase) => (
              <li key={purchase.id}>
                <span>
                  {purchase.label}: {describeCreditPurchase(purchase)}
                </span>
                {releaseId === purchase.id && state ? (
                  <div className="buy-credits-release">
                    <label className="plan-billing-consent-check">
                      <input
                        type="checkbox"
                        checked={releaseAcknowledged}
                        onChange={(event) => onReleaseAcknowledge?.(event.target.checked)}
                      />
                      <span>{state.consent.deliverNow.acknowledgement}</span>
                    </label>
                    <div className="plan-billing-actions">
                      <Button onClick={onReleaseConfirm} disabled={!releaseAcknowledged || busy}>
                        {busy ? "Adding…" : "Add them to my balance now"}
                      </Button>
                      <Button variant="ghost" onClick={onReleaseCancel} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                    {!releaseAcknowledged ? (
                      <p className="usage-muted-note">Tick the box to continue. Nothing is ticked for you.</p>
                    ) : null}
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => onAskRelease?.(purchase.id)} disabled={busy || Boolean(releaseId)}>
                    Deliver now
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {purchases.length ? (
        <div className="usage-history-scroll">
          <table className="usage-history-table">
            <caption className="usage-muted-note">Your recent credit purchases</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Pack</th>
                <th scope="col">Status</th>
                <th scope="col">Receipt reference</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>{formatDate(purchase.paidAt) ?? "—"}</td>
                  <td>{purchase.label}</td>
                  <td>{describeCreditPurchase(purchase)}</td>
                  <td>
                    <code>{purchase.receiptRef ?? "—"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
  success: "Thanks! Stripe is confirming your payment; this can take a few seconds.",
  cancel: "Checkout canceled. Nothing was charged.",
} as const;

/** How often, and how many times, the state is re-read after a successful checkout. */
const CONFIRM_POLL_MS = 3000;
const CONFIRM_POLL_TRIES = 5;

/**
 * Container for {@link BuyCreditsView}: reads `GET /billing/credits`, handles
 * the `?credits=success|cancel` return (refreshing the balance until the
 * webhook lands), records the delivery choice and redirects to Stripe Checkout,
 * and releases a held purchase on request.
 */
export function BuyCreditsSection({
  token,
  addToast,
  onCreditsChanged,
}: {
  token: string | null | undefined;
  addToast: ToastFn;
  onCreditsChanged?: () => void;
}) {
  const [state, setState] = useState<CreditTopUpState | null>(null);
  const [error, setError] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<CreditPackId | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState<DeliveryConsentState>(INITIAL_DELIVERY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [returnNotice, setReturnNotice] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [releaseAcknowledged, setReleaseAcknowledged] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) return null;
    try {
      const next = await getCreditTopUpState(token);
      setState(next);
      setError(false);
      setSelectedPackId((current) => current ?? defaultPackId(next));
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
    const returned = readCreditsReturn(window.location.search);
    if (!returned) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("credits");
    url.searchParams.delete("credits_session");
    window.history.replaceState(null, "", url.toString());
    setReturnNotice(RETURN_NOTICES[returned.result]);
    if (returned.result === "cancel") return;
    const returnedAt = Date.now();
    let tries = 0;
    const poll = async () => {
      tries += 1;
      const next = await load();
      onCreditsChanged?.();
      const latest = findReturnedPurchase(next, returned.sessionId, returnedAt);
      if (latest) {
        setReturnNotice(
          latest.status === "held"
            ? `Payment confirmed. As you chose, your credits are held${
                formatDate(latest.heldUntil) ? ` until ${formatDate(latest.heldUntil)}` : " for 14 days"
              }, then added to your balance.`
            : latest.status === "needs_review"
              ? "Payment received. We are reviewing it before adding the credits."
              : "Payment confirmed. Your credits are in your balance.",
        );
        return;
      }
      if (tries < CONFIRM_POLL_TRIES) {
        pollRef.current = setTimeout(poll, CONFIRM_POLL_MS);
      } else {
        setReturnNotice("Stripe has not confirmed your payment yet. Refresh in a minute to see your credits.");
      }
    };
    void poll();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the return once per token.
  }, [token]);

  const handleContinue = async () => {
    if (!token || !state || !selectedPackId || !isDeliveryConsentComplete(consent) || busy || !consent.choice) return;
    setBusy(true);
    try {
      const { url } = await startCreditCheckout(token, {
        packId: selectedPackId,
        consent: {
          choice: consent.choice,
          acknowledgedWaiver: consent.choice === "deliver_now" && consent.acknowledged,
          textVersion: state.consent.version,
        },
      });
      window.location.assign(url);
    } catch (err) {
      setBusy(false);
      const code = errorCode(err);
      const message =
        code === "contact_email_required"
          ? "Confirm a contact email in Settings → Email first."
          : code === "consent_text_outdated"
            ? "The delivery terms changed. Read them again and choose."
            : code === "billing_unavailable"
              ? "Buying credits is not available on this server yet."
              : "Could not open the checkout. Please try again.";
      addToast({ type: "error", title: "Checkout not started", message });
      setConsent(INITIAL_DELIVERY_CONSENT);
      void load();
    }
  };

  const handleRelease = async () => {
    if (!token || !state || !releaseId || !releaseAcknowledged || busy) return;
    setBusy(true);
    try {
      const next = await deliverHeldCreditsNow(token, releaseId, {
        acknowledgedWaiver: true,
        textVersion: state.consent.version,
      });
      setState(next);
      setReleaseId(null);
      setReleaseAcknowledged(false);
      onCreditsChanged?.();
      addToast({ type: "success", title: "Credits added", message: "Your held credits are in your balance now." });
    } catch (err) {
      const code = errorCode(err);
      addToast({
        type: "error",
        title: "Credits not added",
        message:
          code === "consent_text_outdated"
            ? "The delivery terms changed. Read them again and confirm."
            : code === "credit_purchase_not_held"
              ? "These credits are not on hold any more."
              : "Could not add the credits. Nothing changed; try again.",
      });
      setReleaseAcknowledged(false);
      void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BuyCreditsView
      state={state}
      kind={buyCreditsKind(state, { error })}
      selectedPackId={selectedPackId}
      consentOpen={consentOpen}
      consent={consent}
      busy={busy}
      returnNotice={returnNotice}
      releaseId={releaseId}
      releaseAcknowledged={releaseAcknowledged}
      onSelectPack={setSelectedPackId}
      onOpenConsent={() => {
        setConsentOpen(true);
        setConsent(INITIAL_DELIVERY_CONSENT);
      }}
      onConsentChange={setConsent}
      onBack={() => {
        setConsentOpen(false);
        setConsent(INITIAL_DELIVERY_CONSENT);
      }}
      onContinue={handleContinue}
      onRetry={() => void load()}
      onAskRelease={(id) => {
        setReleaseId(id);
        setReleaseAcknowledged(false);
      }}
      onReleaseAcknowledge={setReleaseAcknowledged}
      onReleaseConfirm={handleRelease}
      onReleaseCancel={() => {
        setReleaseId(null);
        setReleaseAcknowledged(false);
      }}
    />
  );
}
