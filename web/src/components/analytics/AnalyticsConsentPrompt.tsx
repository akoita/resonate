"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  getAnalyticsConsentState,
  loadAnalyticsConsent,
  recordAnalyticsConsentDecision,
  resetAnalyticsConsent,
  subscribeToAnalyticsConsent,
  type AnalyticsConsentState,
} from "../../lib/analyticsConsent";

/**
 * #1772: the surface where a person actually decides about product analytics.
 *
 * It lives in the app shell rather than in Settings because the decision gates
 * collection everywhere. A material change to the consent text closes the gate
 * for everyone at once; if the only way to answer again were a panel several
 * clicks deep, that would be a silent indefinite blackout instead of a
 * question.
 *
 * Three rules here are requirements, not styling:
 *  - Refusing is exactly as easy as accepting. The two actions are the same
 *    size, the same weight, and neither is preselected. A faint "not now" link
 *    beside a bright button is not a free choice.
 *  - It offers no way out except deciding — no close control, no "ask me
 *    later" — and never returns once a decision exists, including a refusal.
 *    Re-asking someone who said no is nagging, and nagging invalidates the
 *    refusal.
 *  - It does NOT block the app. It is a persistent banner, not a modal: no
 *    overlay, no backdrop, no focus trap, playback keeps running behind it.
 *    Obstructing the product until a privacy question is answered contradicts
 *    the copy's own promise that refusing is free, and a consent text change
 *    would otherwise interrupt every signed-in session at once, mid-listen.
 */
export default function AnalyticsConsentPrompt() {
  const { status, token } = useAuth();
  const { addToast } = useToast();
  const [consent, setConsent] = useState<AnalyticsConsentState>(() => getAnalyticsConsentState());
  const [submitting, setSubmitting] = useState<"granted" | "refused" | null>(null);
  const [textChanged, setTextChanged] = useState(false);

  useEffect(() => subscribeToAnalyticsConsent(setConsent), []);

  useEffect(() => {
    if (status !== "authenticated" || !token) {
      // Signing out drops the cached decision so the next account is asked on
      // its own terms instead of inheriting this one.
      resetAnalyticsConsent();
      return;
    }
    void loadAnalyticsConsent(token);
  }, [status, token]);

  const decide = useCallback(
    async (productAnalytics: boolean) => {
      if (!token || submitting) return;
      setSubmitting(productAnalytics ? "granted" : "refused");
      try {
        const result = await recordAnalyticsConsentDecision(token, productAnalytics);
        if (result.status === "reask") {
          // The wording moved while it was on screen. Show it again and ask
          // again; recording the answer against the new text would attribute
          // it to something this person never read.
          setTextChanged(true);
          addToast({
            type: "info",
            title: "This has been updated",
            message: "What we collect has changed. Please read it once more and choose again.",
          });
        }
      } catch {
        addToast({
          type: "error",
          title: "Choice not saved",
          message: "We could not save your answer. Please try again.",
        });
      } finally {
        setSubmitting(null);
      }
    },
    [addToast, submitting, token],
  );

  const open = status === "authenticated" && Boolean(token) && consent.known && consent.needsDecision;

  if (!open) return null;

  return (
    <AnalyticsConsentBanner
      textChanged={textChanged}
      submitting={submitting}
      onDecide={(productAnalytics) => void decide(productAnalytics)}
    />
  );
}

/**
 * The banner itself, kept presentational so the "refusing is as easy as
 * accepting" and "no way out but deciding" rules can be asserted in a test
 * without an auth session.
 *
 * A labelled region rather than a dialog: assistive technology gets a named
 * landmark it can jump to and the two actions are in the normal tab order,
 * while sighted users keep full use of the app behind it.
 */
export function AnalyticsConsentBanner({
  textChanged,
  submitting,
  onDecide,
}: {
  textChanged: boolean;
  submitting: "granted" | "refused" | null;
  onDecide: (productAnalytics: boolean) => void;
}) {
  return (
    <div className="analytics-consent-banner-wrap">
      <section
        className="analytics-consent-banner"
        role="region"
        aria-labelledby="analytics-consent-title"
      >
        <h2 className="analytics-consent-title" id="analytics-consent-title">
          May we measure how you use Resonate?
        </h2>

        {textChanged ? (
          <p className="analytics-consent-notice" role="status">
            What we collect has changed since you were last asked, so please choose again.
          </p>
        ) : null}

        <div className="analytics-consent-body">
          <p>
            We would like to record which parts of Resonate you use — starting a track, saving
            something to your library, searching, opening a listing — so we can see what helps and fix
            what does not.
          </p>
          <p>
            This is entirely optional. Resonate works exactly the same either way: saying no does not
            limit any feature, change any price, or affect your music, your wallet, or your account.
            You can change your answer whenever you like, in Settings under Privacy.{" "}
            <Link href="/help/product-analytics" className="analytics-consent-link">
              Read more about what this covers
            </Link>
            .
          </p>
        </div>

        {/* Equal weight, equal size, nothing preselected. Do not demote either
          * action to a ghost button or a link. */}
        <div className="analytics-consent-actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary analytics-consent-action"
            onClick={() => onDecide(false)}
            disabled={submitting !== null}
          >
            {submitting === "refused" ? "Saving..." : "No, do not measure"}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary analytics-consent-action"
            onClick={() => onDecide(true)}
            disabled={submitting !== null}
          >
            {submitting === "granted" ? "Saving..." : "Yes, measure my use"}
          </button>
        </div>
      </section>
    </div>
  );
}
