"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import { AdminStepUpCancelledError, withAdminStepUp } from "../../../lib/adminStepUp";
import {
  listAdminTakedownNotices,
  resolveTakedownNotice,
  type AdminTakedownNotice,
  type TakedownStatus,
} from "../../../lib/api";
import {
  TAKEDOWN_STATUS_LABELS,
  shortReference,
  takedownCapacityLabel,
  takedownCategoryLabel,
} from "../../../lib/takedownForm";
import styles from "../../../components/takedown/TakedownReportForm.module.css";

const FILTERS: Array<{ value: TakedownStatus | ""; label: string }> = [
  { value: "pending", label: "Waiting" },
  { value: "countered", label: "Countered" },
  { value: "upheld", label: "Upheld" },
  { value: "rejected", label: "Not upheld" },
  { value: "", label: "All" },
];

/**
 * The operator queue for takedown notices (#2664): every field the reporter
 * gave, and a decision with a statement of reasons that the uploader sees.
 * Opening the queue and each decision are recorded in the admin audit log.
 */
export default function TakedownQueuePage() {
  const { token, role, sessionChecked } = useAuth();
  const canReview = role === "admin" || role === "operator";
  const [filter, setFilter] = useState<TakedownStatus | "">("pending");
  const [notices, setNotices] = useState<AdminTakedownNotice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !canReview) return;
    try {
      const data = await listAdminTakedownNotices(token, filter || undefined);
      setNotices(data);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The notices could not be loaded.");
    }
  }, [canReview, filter, token]);

  useEffect(() => {
    if (!sessionChecked || !token || !canReview) return;
    let cancelled = false;
    listAdminTakedownNotices(token, filter || undefined)
      .then((data) => {
        if (!cancelled) setNotices(data);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "The notices could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [canReview, filter, sessionChecked, token]);

  return (
    <AuthGate title="Sign in with an operator account to review takedown notices.">
      <main className="report-page" style={{ width: "min(980px, 100%)" }}>
        <h1>Takedown notices</h1>
        <p className="report-page__lead">
          Notices sent from the public report form. Nothing is removed until you uphold a notice. Write the reasons
          in plain words: the uploader sees them, never the reporter&rsquo;s identity or explanation.
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
                  style={filter === option.value ? undefined : { background: "transparent", color: "inherit", border: "1px solid var(--color-border)" }}
                  onClick={() => {
                    if (option.value === filter) return;
                    setNotices(null);
                    setError(null);
                    setFilter(option.value);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
            {!notices && !error && <p className={styles.hint}>Loading…</p>}
            {notices?.length === 0 && <p className={styles.hint}>No notices here.</p>}
            <div className={styles.form} style={{ maxWidth: "none", marginTop: 20 }}>
              {notices?.map((notice) => <NoticeReview key={notice.id} notice={notice} onDecided={load} />)}
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

function NoticeReview({ notice, onDecided }: { notice: AdminTakedownNotice; onDecided: () => Promise<void> }) {
  const { token, signMessage } = useAuth();
  const { addToast } = useToast();
  const id = useId();
  const [reasons, setReasons] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"upheld" | "rejected" | null>(null);
  const open = notice.status === "pending" || notice.status === "countered";

  const decide = async (outcome: "upheld" | "rejected") => {
    if (!token || busy) return;
    if (!reasons.trim()) {
      setError("Write the statement of reasons first. The uploader sees it with the decision.");
      return;
    }
    setBusy(outcome);
    setError(null);
    try {
      // Upholding removes a track and its stems, so it needs a fresh passkey confirmation (#2362).
      await withAdminStepUp(
        {
          token,
          signMessage,
          onPrompt: () =>
            addToast({ type: "info", title: "Confirm it is you", message: "Your passkey will ask you to confirm this decision." }),
        },
        (proof) => resolveTakedownNotice(token, notice.id, { outcome, statementOfReasons: reasons.trim() }, proof),
      );
      addToast({
        type: "success",
        title: outcome === "upheld" ? "Notice upheld" : "Notice not upheld",
        message: "The uploader has been told the decision and your reasons.",
      });
      await onDecided();
    } catch (reason) {
      if (reason instanceof AdminStepUpCancelledError) {
        addToast({ type: "info", title: "Nothing changed", message: reason.message });
        return;
      }
      setError(reason instanceof Error ? reason.message : "The decision could not be recorded.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.fieldset} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.legend} style={{ margin: 0, padding: 0 }}>
        {shortReference(notice.id)} · {takedownCategoryLabel(notice.category)} ·{" "}
        {TAKEDOWN_STATUS_LABELS[notice.status] ?? notice.status}
      </h2>
      <dl style={{ margin: 0 }}>
        <Row label="Track">
          {notice.track ? (
            <Link href={`/release/${notice.track.releaseId}`}>{notice.track.title}</Link>
          ) : (
            notice.trackId
          )}
        </Row>
        <Row label="Where">{notice.contentLocation ?? "Not given"}</Row>
        <Row label="Work concerned">{notice.originalWorkUrl}</Row>
        <Row label="Reporter">
          {notice.claimantName} ({takedownCapacityLabel(notice.claimantCapacity)})
        </Row>
        <Row label="Email">{notice.claimantEmail}</Row>
        <Row label="Explanation">{notice.reason}</Row>
        <Row label="Good-faith statement">
          {notice.goodFaithAt ? `Confirmed ${new Date(notice.goodFaithAt).toLocaleString()}` : "Not recorded (older notice)"}
        </Row>
        <Row label="Filed">{new Date(notice.createdAt).toLocaleString()}</Row>
        {notice.counterNotice && <Row label="Counter-notice">{notice.counterNotice}</Row>}
        {notice.statementOfReasons && <Row label="Statement of reasons">{notice.statementOfReasons}</Row>}
        <Row label="Full reference">{notice.id}</Row>
      </dl>
      {open && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-reasons`}>
            Statement of reasons
          </label>
          <textarea
            id={`${id}-reasons`}
            className={styles.textarea}
            value={reasons}
            onChange={(e) => setReasons(e.target.value)}
            maxLength={2000}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <p className={styles.error} id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={busy !== null} onClick={() => void decide("upheld")}>
              {busy === "upheld" ? "Removing…" : "Uphold and remove"}
            </button>
            <button
              className={styles.button}
              type="button"
              disabled={busy !== null}
              style={{ background: "transparent", color: "inherit", border: "1px solid var(--color-border)" }}
              onClick={() => void decide("rejected")}
            >
              {busy === "rejected" ? "Saving…" : "Do not uphold"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
