"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  fileTakedownCounterNotice,
  getMyTakedownNotices,
  type CreatorTakedownNotice,
} from "../../../lib/api";
import {
  TAKEDOWN_COUNTER_MAX,
  TAKEDOWN_STATUS_LABELS,
  shortReference,
  takedownCategoryLabel,
} from "../../../lib/takedownForm";
import styles from "../../../components/takedown/TakedownReportForm.module.css";

/**
 * Notices filed about the signed-in creator's tracks, with the decision and
 * the reviewer's reasons, and a counter-notice form for each open one (#2664).
 */
function NoticesList() {
  const { token, sessionChecked } = useAuth();
  const highlighted = useSearchParams().get("id");
  const [notices, setNotices] = useState<CreatorTakedownNotice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getMyTakedownNotices(token);
      setNotices(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Your notices could not be loaded.");
    }
  }, [token]);

  useEffect(() => {
    if (!sessionChecked || !token) return;
    let cancelled = false;
    getMyTakedownNotices(token)
      .then((data) => {
        if (!cancelled) setNotices(data);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Your notices could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionChecked, token]);

  if (loadError) {
    return (
      <p className={styles.alert} role="alert">
        {loadError}{" "}
        <button type="button" className={styles.button} onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  }
  if (!notices) return <p className={styles.hint}>Loading your notices…</p>;
  if (notices.length === 0) {
    return <p className={styles.hint}>No one has filed a notice about your tracks.</p>;
  }
  return (
    <div className={styles.form}>
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} highlighted={notice.id === highlighted} onChanged={load} />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  highlighted,
  onChanged,
}: {
  notice: CreatorTakedownNotice;
  highlighted: boolean;
  onChanged: () => Promise<void>;
}) {
  const { token } = useAuth();
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || sending) return;
    if (!text.trim()) {
      setError("Explain why the content should stay, for example the licence or agreement you hold.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await fileTakedownCounterNotice(token, notice.id, text.trim());
      setText("");
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The counter-notice could not be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className={styles.fieldset}
      aria-labelledby={`${id}-title`}
      style={highlighted ? { borderColor: "var(--color-accent)" } : undefined}
    >
      <h2 id={`${id}-title`} className={styles.legend} style={{ margin: 0, padding: 0 }}>
        &ldquo;{notice.trackTitle}&rdquo; on <Link href={`/release/${notice.releaseId}`}>{notice.releaseTitle}</Link>
      </h2>
      <p className={styles.hint}>
        Reference {shortReference(notice.id)} · Reason: {takedownCategoryLabel(notice.category)} · Filed{" "}
        {new Date(notice.createdAt).toLocaleDateString()}
      </p>
      <p>
        <strong>{TAKEDOWN_STATUS_LABELS[notice.status] ?? notice.status}</strong>
      </p>
      {notice.statementOfReasons && <p>Reviewer&rsquo;s reasons: {notice.statementOfReasons}</p>}
      {notice.counterNotice && <p>Your counter-notice: {notice.counterNotice}</p>}
      {notice.canCounter && (
        <form className={styles.field} onSubmit={send} noValidate>
          <label className={styles.label} htmlFor={`${id}-counter`}>
            Send a counter-notice
          </label>
          <p className={styles.hint} id={`${id}-hint`}>
            If you hold the rights, say why the content should stay. An operator reviews it. You can send one
            counter-notice per notice.
          </p>
          <textarea
            id={`${id}-counter`}
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={TAKEDOWN_COUNTER_MAX}
            required
            aria-invalid={error ? "true" : "false"}
            aria-describedby={[`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" ")}
          />
          {error && (
            <p className={styles.error} id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={sending}>
              {sending ? "Sending…" : "Send counter-notice"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function RespondPage() {
  return (
    <main className="report-page">
      <h1>Notices about your tracks</h1>
      <p className="report-page__lead">
        When someone reports one of your tracks, you see it here with the reason and, once reviewed, the decision and
        why. The reporter&rsquo;s identity and words stay with the operator.
      </p>
      <AuthGate title="Sign in to see notices about your tracks.">
        <Suspense fallback={<p className={styles.hint}>Loading your notices…</p>}>
          <NoticesList />
        </Suspense>
      </AuthGate>
    </main>
  );
}
