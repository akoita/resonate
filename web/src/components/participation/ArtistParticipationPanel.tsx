"use client";

import { useEffect, useState } from "react";
import {
  ApiRequestError,
  acceptParticipationAgreement,
  getArtistParticipation,
  getParticipationAgreement,
  updateParticipationChoices,
  type ArtistParticipationStatus,
  type ParticipationAgreementText,
  type ParticipationConsentChoices,
} from "../../lib/api";
import {
  PARTICIPATION_CHOICES,
  changedChoices,
  choiceIsOn,
  describeChange,
  withChoice,
} from "../../lib/participationChoices";
import { AgreementText } from "../legal/AgreementText";
import { Button } from "../ui/Button";
import styles from "./ArtistParticipationPanel.module.css";

type Props = {
  token: string;
  artistId: string;
  /** Onboarding shows the agreement open and a single Accept button. */
  mode: "onboarding" | "settings";
  onAccepted?: (status: ArtistParticipationStatus) => void;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * The artist participation agreement and the artist's consent choices
 * (#2666): read and accept the current version, change the choices later,
 * and see every change with its date.
 */
export function ArtistParticipationPanel({ token, artistId, mode, onAccepted }: Props) {
  const [agreement, setAgreement] = useState<ParticipationAgreementText | null>(null);
  const [status, setStatus] = useState<ArtistParticipationStatus | null>(null);
  const [draft, setDraft] = useState<ParticipationConsentChoices | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getParticipationAgreement(), getArtistParticipation(token, artistId)])
      .then(([text, current]) => {
        if (cancelled) return;
        setAgreement(text);
        setStatus(current);
        setDraft(current.needsAcceptance ? current.defaultChoices : current.choices);
        setMessage(null);
      })
      .catch(() => {
        if (!cancelled) setMessage("Could not load the participation agreement. Try again in a moment.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, artistId, reload]);

  if (!status || !draft || !agreement) {
    return (
      <div className={styles.panel}>
        <p className={styles.muted} role="status">{message ?? "Loading the participation agreement…"}</p>
      </div>
    );
  }

  const needsAcceptance = status.needsAcceptance;
  const unavailable = !status.agreement.available;
  const pending = changedChoices(status.choices, draft);
  const hasChanges = Object.keys(pending).length > 0;

  const accept = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await acceptParticipationAgreement(token, artistId, {
        version: agreement.version,
        textHash: agreement.textHash,
        choices: draft,
      });
      setStatus(next);
      setDraft(next.choices);
      setAgreed(false);
      onAccepted?.(next);
    } catch (err) {
      const code = err instanceof ApiRequestError ? (err.details as { code?: unknown } | null)?.code : null;
      if (code === "participation_agreement_changed") {
        setMessage("The agreement was updated while you were reading it. Please read the new version.");
        setReload((n) => n + 1);
      } else if (code === "participation_agreement_unavailable") {
        setMessage("Artist sign-up is not open yet: the agreement has not been published.");
      } else {
        setMessage("Your acceptance was not saved. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const saveChoices = async () => {
    if (!hasChanges) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await updateParticipationChoices(token, artistId, pending);
      setStatus(next);
      setDraft(next.choices);
      setMessage("Your choices are saved. They apply to new uses from now on.");
    } catch {
      setMessage("Your choices were not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const choiceList = (
    <fieldset className={styles.choices} disabled={busy || (needsAcceptance && unavailable)}>
      <legend className={styles.legend}>How your music may be used</legend>
      {PARTICIPATION_CHOICES.map((choice) => (
        <label key={choice.setting} className={styles.choice}>
          <input
            type="checkbox"
            checked={choiceIsOn(draft, choice.setting)}
            onChange={(event) => setDraft(withChoice(draft, choice.setting, event.target.checked))}
          />
          <span>
            <strong>{choice.label}</strong>
            <small>{choice.help}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <div className={styles.panel}>
      {agreement.placeholder ? (
        <p className={styles.notice}>
          The final agreement has not been published yet. This test version binds no one.
        </p>
      ) : null}

      {needsAcceptance ? (
        <>
          <p className={styles.lead}>
            {status.acceptances.length > 0
              ? "The agreement has changed since you last accepted it. Please read the new version."
              : "Before you upload, read the agreement and choose how your music may be used. You can change these choices at any time in Settings."}
          </p>
          <div className={styles.agreement} tabIndex={0} aria-label="Artist participation agreement">
            <AgreementText markdown={agreement.text} />
          </div>
          {choiceList}
          {unavailable ? (
            <p className={styles.notice}>Artist sign-up is not open yet: the agreement has not been published.</p>
          ) : (
            <>
              <label className={styles.agree}>
                <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} disabled={busy} />
                <span>I have read the artist participation agreement (version {agreement.version}) and accept it.</span>
              </label>
              <Button variant="primary" onClick={accept} disabled={!agreed || busy}>
                {busy ? "Saving…" : mode === "onboarding" ? "Accept and continue" : "Accept"}
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <p className={styles.lead}>
            You accepted version {status.accepted?.version} on {status.accepted ? formatDate(status.accepted.acceptedAt) : ""}.
          </p>
          <details className={styles.read}>
            <summary>Read the agreement you accepted</summary>
            <div className={styles.agreement} tabIndex={0} aria-label="Artist participation agreement">
              <AgreementText markdown={agreement.text} />
            </div>
          </details>
          {choiceList}
          <div className={styles.actions}>
            <Button variant="primary" onClick={saveChoices} disabled={!hasChanges || busy}>
              {busy ? "Saving…" : "Save choices"}
            </Button>
            {hasChanges ? (
              <Button variant="ghost" onClick={() => setDraft(status.choices)} disabled={busy}>
                Undo changes
              </Button>
            ) : null}
          </div>
          <p className={styles.muted}>
            A change applies to new uses from the moment you save it. Remixes already published stay up unless you turn remixing off.
          </p>
          {status.history.length > 0 ? (
            <details className={styles.read}>
              <summary>Change history</summary>
              <ul className={styles.history}>
                {status.history.map((change) => (
                  <li key={`${change.setting}-${change.changedAt}`}>
                    <time dateTime={change.changedAt}>{formatDate(change.changedAt)}</time>
                    <span>{describeChange(change)}</span>
                    <small>{change.source === "onboarding" ? "at sign-up" : "in Settings"}</small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}

      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </div>
  );
}
