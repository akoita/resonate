"use client";

import { useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  decideRemixApproval,
  getRemixApprovalAudioBlob,
  listRemixApprovals,
  REMIX_APPROVAL_TEXT_MAX,
  type IncomingRemixApproval,
} from "../../../lib/api";
import { approvalStatusLabel } from "../../../lib/remixApproval";

/**
 * Remix approvals (#2682): AI-assisted remixes of the artist's music that
 * wait for their answer. The artist listens to the exact version, then
 * approves or declines it. An approval covers that version only.
 */

type LoadState =
  | { status: "loading" }
  | { status: "ready"; items: IncomingRemixApproval[] }
  | { status: "error" };


function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function ApprovalCard({
  token,
  item,
  onDecided,
}: {
  token: string;
  item: IncomingRemixApproval;
  onDecided: (next: IncomingRemixApproval) => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const listen = async () => {
    setLoadingAudio(true);
    setError(null);
    try {
      const blob = await getRemixApprovalAudioBlob(token, item.id);
      setAudioUrl(URL.createObjectURL(blob));
    } catch {
      setError("This version could not be loaded. The creator may have replaced it.");
    } finally {
      setLoadingAudio(false);
    }
  };

  const decide = async (decision: "approve" | "decline") => {
    setBusy(decision);
    setError(null);
    try {
      const result = await decideRemixApproval(token, item.id, decision, reason);
      onDecided({ ...item, ...result });
    } catch {
      setError("Your answer was not saved. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const pending = item.status === "pending" && item.versionAvailable;

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 remix-approval-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-zinc-100">{item.remixTitle}</h2>
        <span className="text-xs text-zinc-400">{approvalStatusLabel(item)}</span>
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        A remix of <strong className="text-zinc-200">{item.sourceTrack.title}</strong> by {item.creatorName}, asked{" "}
        {formatDay(item.createdAt)}.
      </p>
      {item.message && (
        <p className="mt-2 text-sm text-zinc-300">
          Their note: <q>{item.message}</q>
        </p>
      )}
      {item.status === "declined" && item.reason && (
        <p className="mt-2 text-sm text-zinc-400">
          Your note: <q>{item.reason}</q>
        </p>
      )}

      {item.versionAvailable && (
        <div className="mt-3">
          {audioUrl ? (
            <audio controls src={audioUrl} className="w-full" aria-label={`Listen to ${item.remixTitle}`} />
          ) : (
            <button type="button" className="ui-btn ui-btn-ghost" disabled={loadingAudio} onClick={() => void listen()}>
              {loadingAudio ? "Loading…" : "Listen to this version"}
            </button>
          )}
        </div>
      )}

      {pending && (
        <div className="mt-4">
          <label className="block text-xs text-zinc-400" htmlFor={`approval-reason-${item.id}`}>
            A note for the creator (optional)
          </label>
          <textarea
            id={`approval-reason-${item.id}`}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100"
            rows={2}
            maxLength={REMIX_APPROVAL_TEXT_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={busy !== null}
              onClick={() => void decide("approve")}
            >
              {busy === "approve" ? "Approving…" : "Approve this version"}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-ghost"
              disabled={busy !== null}
              onClick={() => void decide("decline")}
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Approving lets them publish this version on Resonate, and export it if their licence allows. A new version
            needs a new approval. Declining keeps it a private draft.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </li>
  );
}

export default function RemixApprovalsPage() {
  const { token } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listRemixApprovals(token)
      .then((items) => {
        if (!cancelled) setState({ status: "ready", items });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const replace = (next: IncomingRemixApproval) =>
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", items: current.items.map((item) => (item.id === next.id ? next : item)) }
        : current,
    );

  const waiting = state.status === "ready" ? state.items.filter((item) => item.status === "pending" && item.versionAvailable) : [];
  const others = state.status === "ready" ? state.items.filter((item) => !(item.status === "pending" && item.versionAvailable)) : [];

  return (
    <AuthGate title="Sign in to answer remix approval requests.">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-zinc-100">Remix approvals</h1>
        <p className="mt-2 text-sm text-zinc-400">
          You asked to approve AI-assisted remixes of your music before they are shared. Listen to each version, then
          approve or decline it. Nothing is published until you approve.
        </p>

        {state.status === "loading" && <p className="mt-6 text-sm text-zinc-400">Loading…</p>}
        {state.status === "error" && (
          <p role="alert" className="mt-6 text-sm text-red-300">
            Requests could not be loaded. Please try again.
          </p>
        )}

        {state.status === "ready" && token && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-400">Waiting for you</h2>
            {waiting.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No remix is waiting for your approval.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-4">
                {waiting.map((item) => (
                  <ApprovalCard key={item.id} token={token} item={item} onDecided={replace} />
                ))}
              </ul>
            )}
            {others.length > 0 && (
              <>
                <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-zinc-400">Answered</h2>
                <ul className="mt-3 flex flex-col gap-4">
                  {others.map((item) => (
                    <ApprovalCard key={item.id} token={token} item={item} onDecided={replace} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </AuthGate>
  );
}
