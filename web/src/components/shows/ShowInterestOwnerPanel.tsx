"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useProductSurfaces } from "../../hooks/useProductSurfaces";
import type { Campaign } from "../../lib/shows";
import {
  getShowInterestSummary,
  interestSummaryLine,
  setShowCampaignMode,
  showInterestErrorMessage,
  type ShowInterestSummary,
} from "../../lib/showInterest";
import { useCampaignManageAccess } from "./useCampaignManageAccess";

/**
 * #2668: what the campaign's artist (or an operator) sees about interest:
 * counts by city under the minimum-group rule, and the switch between
 * collecting interest and taking pledges.
 */
export function ShowInterestOwnerPanel({
  campaign,
}: {
  campaign: Pick<Campaign, "backendId" | "rawStatus" | "mode">;
}) {
  const access = useCampaignManageAccess(campaign);
  const { token } = useAuth();
  const { surfaces } = useProductSurfaces();
  const pledgingAvailable = surfaces.showsPledging;
  const [mode, setMode] = useState(campaign.mode ?? "pledge");
  const [summary, setSummary] = useState<ShowInterestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"pledge" | "interest" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setSummary(await getShowInterestSummary(campaign.backendId, token));
    } catch (reason) {
      setError(showInterestErrorMessage(reason));
    }
  }, [campaign.backendId, token]);

  useEffect(() => {
    if (access !== "allowed" || mode !== "interest") return;
    let cancelled = false;
    if (token) {
      getShowInterestSummary(campaign.backendId, token)
        .then((next) => {
          if (!cancelled) setSummary(next);
        })
        .catch((reason) => {
          if (!cancelled) setError(showInterestErrorMessage(reason));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [access, campaign.backendId, mode, token]);

  if (access !== "allowed") return null;
  const canCollectInterest = mode === "pledge" && campaign.rawStatus === "draft";
  if (mode === "pledge" && !canCollectInterest) return null;

  const change = async () => {
    const next = confirming;
    if (!token || !next || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setShowCampaignMode(campaign.backendId, token, next);
      setMode(result.mode);
      setNotice(
        result.mode === "pledge"
          ? `Pledges can open now. ${result.notified} ${result.notified === 1 ? "person was" : "people were"} told.`
          : "Fans can now say they would come. Nothing is charged.",
      );
      if (result.mode === "interest") void load();
    } catch (reason) {
      setError(showInterestErrorMessage(reason));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <section className="show-interest-owner" aria-labelledby="show-interest-owner-title">
      <h2 id="show-interest-owner-title">Who would come</h2>
      {mode === "interest" ? (
        <>
          {summary ? (
            <>
              <p>{interestSummaryLine(summary)}</p>
              {summary.cities.length > 0 ? (
                <table className="show-interest-owner__table">
                  <caption className="visually-hidden">People who would come, by city</caption>
                  <thead>
                    <tr>
                      <th scope="col">City</th>
                      <th scope="col">People</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.cities.map((row) => (
                      <tr key={row.city}>
                        <td>{row.city}</td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                    {summary.otherCount > 0 ? (
                      <tr>
                        <td>Other cities or no city</td>
                        <td>{summary.otherCount}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}
              <p className="show-interest-owner__hint">
                A city is shown once at least {summary.minimumGroup} people name it, so nobody can be singled out.
              </p>
            </>
          ) : (
            <p className="show-interest-owner__hint">Loading…</p>
          )}
          <div className="show-interest__actions">
            <button
              type="button"
              className="ui-btn ui-btn-primary ui-btn-sm"
              disabled={busy || !pledgingAvailable}
              onClick={() => setConfirming("pledge")}
            >
              Open pledges
            </button>
            {!pledgingAvailable ? (
              <span className="show-interest-owner__hint">
                Pledges are not available yet. Keep collecting interest; you can open them later.
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="show-interest__actions">
          <p className="show-interest-owner__hint">
            Not ready to take pledges? Ask fans whether they would come first. It costs them nothing.
          </p>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => setConfirming("interest")}>
            Ask who would come
          </button>
        </div>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p className="show-interest__error" role="alert">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        isOpen={confirming !== null}
        title={confirming === "pledge" ? "Open pledges?" : "Ask who would come?"}
        message={
          confirming === "pledge"
            ? "The page switches to pledges, and everyone who asked to be told gets a notice. The counts you collected stay here while the campaign is a draft."
            : "The page asks fans whether they would come instead of taking pledges. You can open pledges later."
        }
        confirmLabel={busy ? "Saving…" : confirming === "pledge" ? "Open pledges" : "Ask who would come"}
        variant="warning"
        onConfirm={change}
        onCancel={() => setConfirming(null)}
      />
    </section>
  );
}
