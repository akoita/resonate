"use client";

import { restoreRelease, withdrawRelease, type Release } from "../../../lib/api";

/**
 * #1793 — an artist taking a release out of streaming, and putting it back.
 *
 * The copy here is the feature. An artist deciding whether to withdraw needs
 * to know three things without having to ask support: new listeners stop being
 * able to stream it, people who already bought it keep it, and the decision is
 * reversible. So the confirmation says all three, plainly, and the restore
 * action says nothing alarming at all — putting music back is not a
 * destructive act and must not be dressed up as one.
 *
 * The handlers are built by a factory rather than written inline in the page
 * so the order of events can be asserted without a browser: asking to withdraw
 * only opens the dialog, and dismissing it must leave the catalog untouched.
 */

type ToastFn = (toast: {
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}) => void;

export const WITHDRAW_CONFIRM_CONFIRM_LABEL = "Withdraw from streaming";
export const WITHDRAW_CONFIRM_CANCEL_LABEL = "Cancel";

export function withdrawConfirmTitle(release: Pick<Release, "title">) {
  return `Withdraw “${release.title}” from streaming?`;
}

export function withdrawConfirmMessage(release: Pick<Release, "title">) {
  return [
    `From now on, nobody new can stream “${release.title}” on Resonate.`,
    "People who bought it keep it. A purchase is theirs, and withdrawing does not reach it.",
    "It stays where listeners saved it — in their libraries and playlists — shown as unavailable, so it does not vanish on them without a word.",
    "You can restore it whenever you want, and all of that comes straight back.",
  ].join("\n\n");
}

/** Is this release currently out of streaming? */
export function isWithdrawnRelease(release: Pick<Release, "status">) {
  return (release.status ?? "").toLowerCase() === "withdrawn";
}

/** A fixed, timezone-stable date for the catalogue row. */
export function formatWithdrawalDate(value?: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(time));
}

export type ReleaseAvailabilityHandlers = {
  /** Opens the confirmation. Deliberately does not call the server. */
  requestWithdraw: (release: Release) => void;
  cancelWithdraw: () => void;
  /**
   * Resolves `false` instead of throwing when the request failed. The caller
   * needs that answer: the shared confirm dialog stays open and disabled until
   * it hears the attempt is over, so a failure that is swallowed here would
   * trap the artist in a modal they cannot close.
   */
  confirmWithdraw: (release: Release, reason?: string) => Promise<boolean>;
  restore: (release: Release) => Promise<boolean>;
};

export function createReleaseAvailabilityHandlers(deps: {
  token: string | null | undefined;
  addToast: ToastFn;
  /** Apply the server's new view of the release to the catalogue list. */
  onUpdated: (release: Release) => void;
  setPending: (release: Release | null) => void;
  setBusyReleaseId: (releaseId: string | null) => void;
}): ReleaseAvailabilityHandlers {
  const { token, addToast, onUpdated, setPending, setBusyReleaseId } = deps;

  function requireToken() {
    if (token) return true;
    addToast({
      type: "info",
      title: "Sign in first",
      message: "Connect your account to manage this release.",
    });
    return false;
  }

  return {
    requestWithdraw(release) {
      setPending(release);
    },

    cancelWithdraw() {
      setPending(null);
    },

    async confirmWithdraw(release, reason) {
      if (!requireToken()) return false;
      setBusyReleaseId(release.id);
      try {
        // The route answers with the release's new availability state, not a
        // whole release, so fold it onto the row the catalogue already has.
        const state = await withdrawRelease(token as string, release.id, reason);
        onUpdated({
          ...release,
          status: state?.status ?? "withdrawn",
          withdrawnAt: state?.withdrawnAt ?? new Date().toISOString(),
          withdrawalReason: state?.withdrawalReason ?? reason?.trim() ?? null,
        });
        setPending(null);
        addToast({
          type: "success",
          title: "Withdrawn from streaming",
          message: `“${release.title}” is no longer streaming. Restore it whenever you want.`,
        });
        return true;
      } catch {
        // Nothing changed, and that is the useful thing to say. The artist did
        // nothing wrong here.
        addToast({
          type: "error",
          title: "Couldn't withdraw it",
          message: "Something went wrong on our side, so nothing changed. Please try again.",
        });
        return false;
      } finally {
        setBusyReleaseId(null);
      }
    },

    async restore(release) {
      if (!requireToken()) return false;
      setBusyReleaseId(release.id);
      try {
        const state = await restoreRelease(token as string, release.id);
        onUpdated({
          ...release,
          status: state?.status ?? "published",
          withdrawnAt: state?.withdrawnAt ?? null,
          withdrawalReason: state?.withdrawalReason ?? null,
        });
        addToast({
          type: "success",
          title: "Back in streaming",
          message: `“${release.title}” can be streamed again.`,
        });
        return true;
      } catch {
        addToast({
          type: "error",
          title: "Couldn't restore it",
          message: "Something went wrong on our side, so nothing changed. Please try again.",
        });
        return false;
      } finally {
        setBusyReleaseId(null);
      }
    },
  };
}

/**
 * The mark a withdrawn release carries in the catalogue: the state, when it
 * happened, and the artist's own note if they left one.
 */
export function ReleaseWithdrawnMarker({ release }: { release: Release }) {
  if (!isWithdrawnRelease(release)) return null;
  const withdrawnOn = formatWithdrawalDate(release.withdrawnAt);
  const note = release.withdrawalReason?.trim();

  return (
    <div className="release-withdrawn-marker" style={{ display: "grid", gap: "2px" }}>
      <span
        className="status-capsule-badge inactive"
        style={{ fontSize: "10px", padding: "2px 8px", justifySelf: "start" }}
      >
        Withdrawn
      </span>
      <span style={{ fontSize: "11px", opacity: 0.6 }}>
        {withdrawnOn ? `Not streaming since ${withdrawnOn}` : "Not streaming"}
      </span>
      {note ? (
        <span style={{ fontSize: "11px", opacity: 0.6 }}>Your note: “{note}”</span>
      ) : null}
    </div>
  );
}

/**
 * The control itself. Withdraw asks first (the page opens the shared confirm
 * dialog); restore is one plain action with no warning attached to it.
 */
export function ReleaseAvailabilityActions({
  release,
  busy,
  onWithdraw,
  onRestore,
}: {
  release: Release;
  busy: boolean;
  onWithdraw: (release: Release) => void;
  onRestore: (release: Release) => void;
}) {
  const withdrawn = isWithdrawnRelease(release);
  const label = withdrawn
    ? busy
      ? "Restoring…"
      : "Restore to streaming"
    : busy
      ? "Withdrawing…"
      : "Withdraw from streaming";

  return (
    <button
      type="button"
      className="wallet-connect-btn"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => (withdrawn ? onRestore(release) : onWithdraw(release))}
      style={{
        padding: "6px 14px",
        fontSize: "12px",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.10)",
        color: "var(--r-on-surface)",
        opacity: busy ? 0.6 : 1,
        cursor: busy ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
