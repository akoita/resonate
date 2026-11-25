"use client";

/**
 * #2659: upload limits on an artist's record. Accounts that are not yet
 * verified may publish a few releases and tracks a day and in total; an admin
 * lifts the limits for one account (for a known artist with a large catalog)
 * or restores them. Pure view; `UploadLimitsControls` loads and changes it.
 */
export type UploadLimitsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lifted: boolean; verified: boolean };

export default function UploadLimitsPanel({
  state,
  busy,
  onRequest,
  onRetry,
}: {
  state: UploadLimitsState;
  busy: boolean;
  onRequest: (lifted: boolean) => void;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return <p className="admin-users-note" role="status">Loading upload limits…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="admin-users-error" role="alert">
        {state.message}{" "}
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onRetry}>
          Try again
        </button>
      </p>
    );
  }
  if (state.verified) {
    return <p className="admin-users-note">Verified artists have no upload limits.</p>;
  }
  return (
    <div className="admin-users-upload-limits">
      <p className="admin-users-note">
        {state.lifted
          ? "Upload limits are lifted for this artist. They can publish as much as a verified artist."
          : "This artist has the upload limits of a new account: a few releases and tracks a day, and a total, until they are verified."}
      </p>
      <button
        type="button"
        className={state.lifted ? "ui-btn ui-btn-ghost" : "ui-btn ui-btn-primary"}
        disabled={busy}
        onClick={() => onRequest(!state.lifted)}
      >
        {state.lifted ? "Restore upload limits" : "Lift upload limits"}
      </button>
    </div>
  );
}

export function getUploadLimitsConfirmCopy(lifted: boolean, who: string) {
  return lifted
    ? {
        title: "Lift upload limits?",
        message: `${who} will be able to publish without the daily and total limits for new accounts. The change is recorded in the audit log.`,
        confirmLabel: "Lift limits",
      }
    : {
        title: "Restore upload limits?",
        message: `${who} will have the daily and total limits for new accounts again. Releases already published stay.`,
        confirmLabel: "Restore limits",
      };
}
