"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import {
  listAdminSupportRequests,
  setSupportRequestStatus,
  type AdminSupportRequest,
  type SupportRequestStatus,
} from "../../../lib/api";
import { SUPPORT_STATUS_LABELS, supportTopicLabel } from "../../../lib/supportForm";
import { shortReference } from "../../../lib/takedownForm";
import styles from "../../../components/takedown/TakedownReportForm.module.css";

const FILTERS: Array<{ value: SupportRequestStatus | ""; label: string }> = [
  { value: "new", label: "New" },
  { value: "answered", label: "Answered" },
  { value: "closed", label: "Closed" },
  { value: "", label: "All" },
];

const QUIET_BUTTON = { background: "transparent", color: "inherit", border: "1px solid var(--color-border)" } as const;

/**
 * The operator queue for support requests (#2667). Answer by email from your
 * own mailbox, then mark the request answered. Opening the queue and each
 * status change are recorded in the admin audit log.
 */
export default function SupportQueuePage() {
  const { token, role, sessionChecked } = useAuth();
  const canReview = role === "admin" || role === "operator";
  const [filter, setFilter] = useState<SupportRequestStatus | "">("new");
  const [requests, setRequests] = useState<AdminSupportRequest[] | null>(null);
  const [counts, setCounts] = useState<Record<SupportRequestStatus, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canReview) return;
    try {
      const data = await listAdminSupportRequests(token, filter || undefined);
      setRequests(data.requests);
      setCounts(data.counts);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The requests could not be loaded.");
    }
  }, [canReview, filter, token]);

  useEffect(() => {
    if (!sessionChecked || !token || !canReview) return;
    let cancelled = false;
    listAdminSupportRequests(token, filter || undefined)
      .then((data) => {
        if (cancelled) return;
        setRequests(data.requests);
        setCounts(data.counts);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The requests could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [canReview, filter, sessionChecked, token]);

  return (
    <AuthGate title="Sign in with an operator account to read support requests.">
      <main className="report-page" style={{ width: "min(980px, 100%)" }}>
        <h1>Support requests</h1>
        <p className="report-page__lead">
          Messages sent from the Contact support form. Answer from your own mailbox using the reply address, then mark
          the request answered. For a problem that affects everyone, post a service status from{" "}
          <Link href="/admin/notices">Notices</Link>.
        </p>
        {!canReview ? (
          <p className={styles.alert}>This queue is for operators and admins.</p>
        ) : (
          <>
            <div className={styles.actions} role="group" aria-label="Filter by status">
              {FILTERS.map((option) => (
                <button
                  key={option.value || "all"}
                  type="button"
                  className={styles.button}
                  aria-pressed={filter === option.value}
                  style={filter === option.value ? undefined : QUIET_BUTTON}
                  onClick={() => {
                    if (option.value === filter) return;
                    setRequests(null);
                    setError(null);
                    setFilter(option.value);
                  }}
                >
                  {option.label}
                  {option.value && counts ? ` (${counts[option.value]})` : ""}
                </button>
              ))}
            </div>
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
            {!requests && !error && <p className={styles.hint}>Loading…</p>}
            {requests?.length === 0 && <p className={styles.hint}>No requests here.</p>}
            <div className={styles.form} style={{ maxWidth: "none", marginTop: 20 }}>
              {requests?.map((request) => <RequestReview key={request.id} request={request} onChanged={load} />)}
            </div>
          </>
        )}
      </main>
    </AuthGate>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className={styles.label}>{label}</dt>
      <dd style={{ margin: "0 0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</dd>
    </>
  );
}

function RequestReview({ request, onChanged }: { request: AdminSupportRequest; onChanged: () => Promise<void> }) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const id = useId();
  const [busy, setBusy] = useState<SupportRequestStatus | null>(null);

  const move = async (status: SupportRequestStatus) => {
    if (!token || busy) return;
    setBusy(status);
    try {
      await setSupportRequestStatus(token, request.id, status);
      addToast({ type: "success", title: `Marked ${SUPPORT_STATUS_LABELS[status].toLowerCase()}`, message: shortReference(request.id) });
      await onChanged();
    } catch (reason) {
      addToast({
        type: "error",
        title: "Nothing changed",
        message: reason instanceof Error ? reason.message : "The status could not be saved.",
      });
    } finally {
      setBusy(null);
    }
  };

  const next: SupportRequestStatus[] = (["answered", "closed", "new"] as const).filter((s) => s !== request.status);

  return (
    <section className={styles.fieldset} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.legend} style={{ margin: 0, padding: 0 }}>
        {shortReference(request.id)} · {supportTopicLabel(request.topic)} · {SUPPORT_STATUS_LABELS[request.status] ?? request.status}
      </h2>
      <dl style={{ margin: 0 }}>
        <Row label="Message">{request.message}</Row>
        <Row label="From">
          {request.signedIn && request.userId ? (
            <Link href={`/admin/users/${encodeURIComponent(request.userId)}`}>A signed-in account</Link>
          ) : (
            "A signed-out visitor"
          )}
        </Row>
        <Row label="Reply to">
          {request.replyTo ? <a href={`mailto:${request.replyTo}`}>{request.replyTo}</a> : "No address given: we cannot write back"}
        </Row>
        <Row label="Sent">{new Date(request.createdAt).toLocaleString()}</Row>
        {request.statusChangedAt && <Row label="Status changed">{new Date(request.statusChangedAt).toLocaleString()}</Row>}
        <Row label="Full reference">{request.id}</Row>
      </dl>
      <div className={styles.actions}>
        {next.map((status, index) => (
          <button
            key={status}
            className={styles.button}
            type="button"
            disabled={busy !== null}
            style={index === 0 ? undefined : QUIET_BUTTON}
            onClick={() => void move(status)}
          >
            {busy === status ? "Saving…" : status === "new" ? "Reopen" : `Mark ${SUPPORT_STATUS_LABELS[status].toLowerCase()}`}
          </button>
        ))}
      </div>
    </section>
  );
}
