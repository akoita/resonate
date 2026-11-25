"use client";

import { useState } from "react";
import { getAdminArtistParticipation, type ArtistParticipationStatus } from "../../../../lib/api";
import { PARTICIPATION_CHOICES, choiceIsOn, describeChange } from "../../../../lib/participationChoices";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; record: ArtistParticipationStatus };

function day(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * #2666: the artist's participation agreement acceptances, current consent
 * choices and their history, read-only. Opened on demand because each
 * opening is recorded in the admin audit log.
 */
export default function ParticipationRecordSection({ token, artistId }: { token: string | null; artistId: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  const open = () => {
    if (!token) return;
    setState({ status: "loading" });
    getAdminArtistParticipation(token, artistId)
      .then((record) => setState({ status: "ready", record }))
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load the record." }),
      );
  };

  if (state.status === "idle" || state.status === "error") {
    return (
      <div>
        <p className="admin-users-note">
          Which agreement versions this artist accepted, their consent choices and every change. Opening it is recorded in the audit log.
        </p>
        {state.status === "error" ? <p className="admin-users-error" role="alert">{state.message}</p> : null}
        <button type="button" className="ui-btn ui-btn-ghost" onClick={open} disabled={!token}>
          Show participation record
        </button>
      </div>
    );
  }
  if (state.status === "loading") {
    return <p className="admin-users-note" role="status">Loading the participation record…</p>;
  }

  const { record } = state;
  return (
    <div className="admin-users-participation">
      <p className="admin-users-note">
        {record.accepted
          ? `Accepted the current version (${record.accepted.version}) on ${day(record.accepted.acceptedAt)}.`
          : `Has not accepted the current version (${record.agreement.version}).`}
        {record.acceptances.length > (record.accepted ? 1 : 0)
          ? ` Earlier: ${record.acceptances.filter((a) => a.version !== record.accepted?.version).map((a) => `${a.version} on ${day(a.acceptedAt)}`).join(", ")}.`
          : ""}
      </p>
      <ul className="admin-users-note">
        {PARTICIPATION_CHOICES.map((choice) => (
          <li key={choice.setting}>
            {choice.label}: <strong>{choiceIsOn(record.choices, choice.setting) ? "yes" : "no"}</strong>
          </li>
        ))}
      </ul>
      {record.history.length > 0 ? (
        <ul className="admin-users-note">
          {record.history.map((change) => (
            <li key={`${change.setting}-${change.changedAt}`}>
              {day(change.changedAt)}: {describeChange(change)} ({change.source === "onboarding" ? "at sign-up" : "in Settings"})
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
