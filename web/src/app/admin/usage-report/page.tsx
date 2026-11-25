"use client";

import { useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { getCompositionUsageReport, usageReportFileName } from "../../../lib/composition";
import styles from "../../../components/takedown/TakedownReportForm.module.css";
import "../../../styles/composition.css";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * #2669: operators download plays per track with the recording code, the work
 * code and the writers, as a CSV shaped for usage reporting. Each download is
 * recorded in the admin audit log.
 */
export default function UsageReportPage() {
  const { token, role } = useAuth();
  const canExport = role === "admin" || role === "operator";
  const today = new Date();
  const [from, setFrom] = useState(isoDate(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(isoDate(today));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // The end date is inclusive for the operator: the report runs to the start of the next day.
      const end = new Date(`${to}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const report = await getCompositionUsageReport(token, `${from}T00:00:00Z`, end.toISOString());
      const url = URL.createObjectURL(new Blob([report.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = usageReportFileName(from, to);
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        report.rows === 0
          ? "No plays were recorded in this period. The file has the header only."
          : `Downloaded ${report.rows} ${report.rows === 1 ? "track" : "tracks"}.${report.truncated ? " The report reached its row limit; choose a shorter period for the rest." : ""}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthGate title="Sign in with an operator account to download usage reports.">
      <main className="report-page usage-report">
        <h1>Usage report</h1>
        <p className="report-page__lead">
          Plays per track with the recording code (ISRC), the work code (ISWC), the writers with their roles, shares,
          societies and IPI numbers, and the publisher, as entered by the artist. Plays count only listeners who
          allowed product analytics. Tracks with no composition details still appear, with those columns empty.
        </p>
        {!canExport ? (
          <p className={styles.alert}>This report is for operators and admins.</p>
        ) : (
          <>
            <div className="usage-report__range">
              <label>
                <span>From</span>
                <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                <span>To (included)</span>
                <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
              </label>
              <button type="button" className={styles.button} onClick={() => void download()} disabled={busy || !from || !to}>
                {busy ? "Preparing..." : "Download CSV"}
              </button>
            </div>
            {message && (
              <p className={styles.hint} role="status">
                {message}
              </p>
            )}
            {error && (
              <p className={styles.alert} role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </main>
    </AuthGate>
  );
}
