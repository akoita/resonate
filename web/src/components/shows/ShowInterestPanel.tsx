"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { Campaign } from "../../lib/shows";
import {
  SHOW_INTEREST_CITY_MAX,
  declareShowInterest,
  getShowInterest,
  interestConfirmation,
  showInterestErrorMessage,
  withdrawShowInterest,
  type ShowInterestState,
} from "../../lib/showInterest";

/**
 * Shows "I would come" (#2668). One action for the fan, an optional city they
 * type themselves (never inferred), and an optional "tell me when it opens".
 * No payment, wallet or contract anywhere on this path.
 */
export function ShowInterestPanel({ campaign }: { campaign: Pick<Campaign, "backendId" | "city"> }) {
  const { token, status, sessionChecked, connectPrivy } = useAuth();
  const signedIn = status === "authenticated" && Boolean(token);
  const id = useId();
  const [state, setState] = useState<ShowInterestState | null>(null);
  const [city, setCity] = useState("");
  const [notify, setNotify] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionChecked) return;
    let cancelled = false;
    getShowInterest(campaign.backendId, signedIn ? token : null)
      .then((next) => {
        if (cancelled) return;
        setState(next);
        if (next.mine) {
          setCity(next.mine.city ?? "");
          setNotify(next.mine.notifyWhenOpen);
        }
      })
      .catch(() => {
        if (!cancelled) setState({ mode: "interest", open: true, mine: null });
      });
    return () => {
      cancelled = true;
    };
  }, [campaign.backendId, sessionChecked, signedIn, token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!signedIn || !token) {
      void connectPrivy();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmed = city.trim();
      const mine = await declareShowInterest(campaign.backendId, token, {
        ...(trimmed ? { city: trimmed } : {}),
        notifyWhenOpen: notify,
      });
      setState((current) => ({ mode: "interest", open: current?.open ?? true, mine }));
      setEditing(false);
    } catch (reason) {
      setError(showInterestErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawShowInterest(campaign.backendId, token);
      setState((current) => (current ? { ...current, mine: null } : current));
      setCity("");
      setNotify(true);
    } catch (reason) {
      setError(showInterestErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const mine = state?.mine ?? null;
  const closed = state !== null && !state.open;

  return (
    <article className="show-detail__pledge-panel show-interest" aria-labelledby={`${id}-title`}>
      <div className="show-detail__pledge-header">
        <span className="shows-home-section__kicker" id={`${id}-title`}>
          Would you come?
        </span>
        <span className="show-detail__soon-pill">Free</span>
      </div>
      <p className="show-interest__lead">
        Tell the artist you would come to this show. It costs nothing and asks for no wallet. The artist sees how many
        people would come, and where, to decide whether to book it.
      </p>

      {mine && !editing ? (
        <div className="show-interest__done" role="status">
          <p>{interestConfirmation(mine)}</p>
          <div className="show-interest__actions">
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => setEditing(true)}>
              Change
            </button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => void withdraw()}>
              {busy ? "Saving…" : "I changed my mind"}
            </button>
          </div>
        </div>
      ) : closed ? (
        <p className="show-interest__closed" role="status">
          This show is no longer asking who would come.
        </p>
      ) : (
        <form className="show-interest__form" onSubmit={submit}>
          <label className="show-interest__field">
            <span>Your city (optional)</span>
            <input
              type="text"
              name="interest-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              maxLength={SHOW_INTEREST_CITY_MAX}
              autoComplete="address-level2"
              placeholder={`For example ${campaign.city}`}
            />
            <small>
              Only you choose this. The artist sees a city only once enough people name it, never who they are.
            </small>
          </label>
          <label className="show-interest__check">
            <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
            <span>Tell me when tickets or pledges open</span>
          </label>
          <button type="submit" className="ui-btn ui-btn-primary" disabled={busy || !sessionChecked}>
            {busy ? "Saving…" : signedIn ? "I would come" : "Sign in to say you would come"}
          </button>
        </form>
      )}

      {error ? (
        <p className="show-interest__error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
