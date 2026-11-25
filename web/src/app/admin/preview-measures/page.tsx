"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { getPreviewMeasures, type PreviewMeasures } from "../../../lib/previewMeasures";
import { PreviewMeasuresView } from "../../../components/admin/PreviewMeasuresView";
import styles from "../../../components/takedown/TakedownReportForm.module.css";
import "../../../styles/preview-measures.css";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Preview measures (#2670): whether invited artists publish, whether new
 * listeners come back, which features are used, and how support and safety
 * are doing. Admin only; each view is recorded in the admin audit log.
 */
export default function PreviewMeasuresPage() {
  const { token, role, sessionChecked } = useAuth();
  const isAdmin = role === "admin";
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 27 * DAY_MS)));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [data, setData] = useState<PreviewMeasures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token || !isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const end = new Date(`${to}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      setData(await getPreviewMeasures(token, `${from}T00:00:00Z`, end.toISOString()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The measures could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [from, isAdmin, to, token]);

  useEffect(() => {
    if (!sessionChecked || !token || !isAdmin) return;
    void load();
    // Load once for the default period; later periods load on "Show".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked, token, isAdmin]);

  return (
    <AuthGate title="Sign in with an admin account to read the preview measures.">
      <main className="report-page preview-measures">
        <h1>Preview measures</h1>
        <p className="report-page__lead">
          Whether invited artists publish, whether new listeners come back, and which features people use. Counts from 1
          to 4 are shown as &ldquo;fewer than five&rdquo;, and a percentage only when its group has at least five people.
        </p>
        {!isAdmin ? (
          <p className={styles.alert}>This page is for admins.</p>
        ) : (
          <>
            <form
              className="preview-measures__range"
              onSubmit={(event) => {
                event.preventDefault();
                void load();
              }}
            >
              <label>
                <span>From</span>
                <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                <span>To (included)</span>
                <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
              </label>
              <button type="submit" className={styles.button} disabled={loading}>
                {loading ? "Loading..." : "Show"}
              </button>
            </form>
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
            {data && <PreviewMeasuresView data={data} />}
          </>
        )}
      </main>
    </AuthGate>
  );
}
