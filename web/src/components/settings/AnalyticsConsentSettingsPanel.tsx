"use client";

import { useEffect, useState } from "react";
import {
  getAnalyticsConsentState,
  loadAnalyticsConsent,
  recordAnalyticsConsentDecision,
  subscribeToAnalyticsConsent,
  type AnalyticsConsentState,
} from "../../lib/analyticsConsent";
import { Button } from "../ui/Button";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

/**
 * #1772: change the analytics decision later, and see what it currently is.
 *
 * The prompt in the app shell asks once. This is where someone who said yes can
 * say no, and where someone who said no can change their mind without being
 * asked again unprompted.
 */
export default function AnalyticsConsentSettingsPanel({ token, addToast }: Props) {
  const [consent, setConsent] = useState<AnalyticsConsentState>(() => getAnalyticsConsentState());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"granted" | "refused" | null>(null);

  useEffect(() => subscribeToAnalyticsConsent(setConsent), []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    void loadAnalyticsConsent(token, { force: true }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const decide = async (productAnalytics: boolean) => {
    if (!token || saving) return;
    setSaving(productAnalytics ? "granted" : "refused");
    try {
      const result = await recordAnalyticsConsentDecision(token, productAnalytics);
      if (result.status === "reask") {
        // Stale consent text: the answer was not recorded, and re-sending it
        // against the new wording would record agreement to text this person
        // has not read. The app shell will ask again with the current text.
        addToast({
          type: "info",
          title: "This has been updated",
          message: "What we collect has changed, so we will ask you again with the new wording.",
        });
        return;
      }
      addToast({
        type: "success",
        title: productAnalytics ? "Usage measurement on" : "Usage measurement off",
        message: productAnalytics
          ? "Thank you — this helps us see what works."
          : "We will not record how you use Resonate.",
      });
    } catch {
      addToast({
        type: "error",
        title: "Choice not saved",
        message: "We could not save your answer. Please try again.",
      });
    } finally {
      setSaving(null);
    }
  };

  const currentLabel = !consent.known
    ? "Checking..."
    : !consent.decided
      ? "Not chosen yet — nothing is being recorded"
      : consent.productAnalytics
        ? "On — thank you"
        : "Off — nothing is being recorded";

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <span className="settings-kicker">Privacy</span>
          <h2 className="settings-section-title">Usage measurement</h2>
          <p className="settings-copy">
            With your permission we record which parts of Resonate you use — starting a track, saving
            to your library, searching, opening a listing — so we can see what helps and fix what does
            not. It is optional, and Resonate works exactly the same either way. Your purchases,
            uploads, and payouts are kept whatever you choose here, because they are records of what
            happened.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => token && void loadAnalyticsConsent(token, { force: true })}
          disabled={loading || !token}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="analytics-consent-settings">
        <p className="analytics-consent-settings__state">
          <strong>Current choice:</strong> <span>{currentLabel}</span>
        </p>
        <div className="analytics-consent-actions analytics-consent-actions--inline">
          <button
            type="button"
            className="ui-btn ui-btn-primary analytics-consent-action"
            onClick={() => void decide(false)}
            disabled={!token || saving !== null}
            aria-pressed={consent.known && consent.decided && !consent.productAnalytics}
          >
            {saving === "refused" ? "Saving..." : "Do not measure"}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary analytics-consent-action"
            onClick={() => void decide(true)}
            disabled={!token || saving !== null}
            aria-pressed={consent.known && consent.decided && consent.productAnalytics}
          >
            {saving === "granted" ? "Saving..." : "Measure my use"}
          </button>
        </div>
      </div>
    </div>
  );
}
