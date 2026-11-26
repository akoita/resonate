"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRemixProjectApproval,
  requestRemixApproval,
  REMIX_APPROVAL_TEXT_MAX,
  type RemixProjectApprovalState,
} from "../../lib/api";

/**
 * Artist approval of this remix version (#2682). Shown in the studio when
 * the source artist asked to approve AI-assisted remixes of their work. The
 * creator asks for the current draft; the artist listens and answers. An
 * approval covers this version only, so a new draft needs a new one.
 */

function names(list: Array<{ displayName: string }>): string {
  const all = list.map((item) => item.displayName.trim() || "The artist");
  if (all.length <= 1) return all[0] ?? "The artist";
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
}

export type ApprovalSummary =
  | { kind: "none" }
  | { kind: "no_version" }
  | { kind: "not_asked" }
  | { kind: "pending" }
  | { kind: "approved" }
  | { kind: "declined"; artist: string; reason: string | null };

/** What the panel should say for an approval state. Exported for tests. */
export function summarizeApproval(state: RemixProjectApprovalState | null): ApprovalSummary {
  if (!state || state.requiredArtists.length === 0) return { kind: "none" };
  if (!state.currentVersionKey) return { kind: "no_version" };
  const declined = state.current.find((row) => row.status === "declined");
  if (declined) {
    return { kind: "declined", artist: declined.sourceArtist.displayName, reason: declined.reason };
  }
  if (state.approved) return { kind: "approved" };
  if (state.current.length === 0) return { kind: "not_asked" };
  // Asked: some artists may still be missing (a second source added later).
  const askedIds = new Set(state.current.map((row) => row.sourceArtist.id));
  const allAsked = state.requiredArtists.every((artist) => askedIds.has(artist.id));
  return allAsked ? { kind: "pending" } : { kind: "not_asked" };
}

export function RemixApprovalPanel({
  token,
  projectId,
  versionKey,
  onChanged,
}: {
  token: string;
  projectId: string;
  /** The current completed draft's version, or null. Reloads on change. */
  versionKey: string | null;
  /** Called after the state changes, so eligibility is checked again. */
  onChanged: () => void;
}) {
  const [state, setState] = useState<RemixProjectApprovalState | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await getRemixProjectApproval(token, projectId));
      setError(null);
    } catch {
      setError("Could not load the artist's approval. Try again in a moment.");
    }
  }, [token, projectId]);

  useEffect(() => {
    void load();
  }, [load, versionKey]);

  const summary = summarizeApproval(state);
  const wasApproved = summary.kind === "approved";
  useEffect(() => {
    if (wasApproved) onChanged();
    // Only when an approval appears, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasApproved, versionKey]);

  if (summary.kind === "none" && !error) return null;

  const who = state ? names(state.requiredArtists) : "The artist";

  const ask = async () => {
    setSending(true);
    setError(null);
    try {
      setState(await requestRemixApproval(token, projectId, message));
      setMessage("");
      onChanged();
    } catch (err) {
      const text = err instanceof Error ? err.message : "";
      setError(
        text.includes("version_declined")
          ? "The artist declined this version. Make a new draft to ask again."
          : "The request could not be sent. Try again in a moment.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      aria-labelledby="remix-approval-heading"
      className="mt-4 bg-zinc-900 border border-zinc-800 rounded-lg p-5 remix-approval-panel"
    >
      <h3 id="remix-approval-heading" className="text-sm font-semibold text-zinc-100">
        Artist approval
      </h3>

      {summary.kind === "no_version" && (
        <p className="mt-2 text-sm text-zinc-400">
          {who} approves remixes of their music before they are shared. Finish a draft, then ask
          them to approve it.
        </p>
      )}

      {summary.kind === "not_asked" && (
        <>
          <p className="mt-2 text-sm text-zinc-400">
            {who} approves remixes of their music before they are shared. Until they approve this
            version, it stays a private draft. They can listen to it before they answer.
          </p>
          <label className="mt-3 block text-xs text-zinc-400" htmlFor="remix-approval-message">
            A note for the artist (optional)
          </label>
          <textarea
            id="remix-approval-message"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
            rows={2}
            maxLength={REMIX_APPROVAL_TEXT_MAX}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button
            type="button"
            className="ui-btn ui-btn-primary mt-3 remix-approval-ask"
            disabled={sending}
            onClick={() => void ask()}
          >
            {sending ? "Sending…" : `Ask ${who} to approve`}
          </button>
        </>
      )}

      {summary.kind === "pending" && (
        <p role="status" className="mt-2 text-sm text-zinc-300 remix-approval-pending">
          Waiting for {who} to answer. You will get a notice when they do. A new draft would need a
          new approval.
        </p>
      )}

      {summary.kind === "approved" && (
        <p role="status" className="mt-2 text-sm text-emerald-300 remix-approval-approved">
          {who} approved this version. You can publish it. A new draft needs a new approval.
        </p>
      )}

      {summary.kind === "declined" && (
        <div role="status" className="mt-2 text-sm remix-approval-declined">
          <p className="text-zinc-300">
            {summary.artist} declined this version, so it stays a private draft.
          </p>
          {summary.reason && (
            <p className="mt-1 text-zinc-400">
              Their note: <q>{summary.reason}</q>
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500">You can make a new draft and ask again.</p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
