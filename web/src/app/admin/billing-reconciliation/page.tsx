"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  downloadBillingReconciliationCsv,
  getBillingReconciliation,
  type BillingReconciliationReport,
  type BillingReconciliationSection,
} from "../../../lib/api";
import ReconciliationView, {
  type ReconciliationDownloading,
  type ReconciliationState,
} from "./ReconciliationView";
import {
  csvFileName,
  jsonFileName,
  previousUtcMonth,
  reconciliationErrorMessage,
  reconciliationMonthOptions,
  saveBlobAsFile,
} from "./reconciliation";

/** #2497: the monthly billing reconciliation report. Operators and admins; the server enforces the same rule. */
function BillingReconciliation() {
  const { token, role } = useAuth();
  const allowed = role === "admin" || role === "operator";
  // Month options and the default month are fixed when the page opens.
  const monthOptions = useMemo(() => reconciliationMonthOptions(new Date()), []);
  const [month, setMonth] = useState(() => previousUtcMonth(new Date()));
  const [reloads, setReloads] = useState(0);
  // The latest answer and the request it answered; a refresh keeps the same month's report up, a new month shows loading.
  const [loaded, setLoaded] = useState<{ key: string; state: ReconciliationState } | null>(null);
  const [downloading, setDownloading] = useState<ReconciliationDownloading | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const key = `${month}|${reloads}`;
  const downloadingRef = useRef(false);

  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    const finish = (state: ReconciliationState) => {
      if (!cancelled) setLoaded({ key, state });
    };
    getBillingReconciliation(token, month)
      .then((report) => finish({ status: "ready", report }))
      .catch((error: unknown) => finish({ status: "error", message: reconciliationErrorMessage(error) }));
    return () => {
      cancelled = true;
    };
  }, [token, allowed, month, key]);

  const state: ReconciliationState =
    loaded?.key === key
      ? loaded.state
      : loaded?.state.status === "ready" && loaded.state.report.month === month
        ? { ...loaded.state, refreshing: true }
        : { status: "loading" };

  const runDownload = useCallback(
    async (kind: ReconciliationDownloading, produce: () => Promise<{ blob: Blob; fileName: string }>) => {
      if (downloadingRef.current) return;
      downloadingRef.current = true;
      setDownloading(kind);
      setDownloadError(null);
      try {
        const { blob, fileName } = await produce();
        saveBlobAsFile(blob, fileName);
      } catch (error: unknown) {
        setDownloadError(reconciliationErrorMessage(error));
      } finally {
        downloadingRef.current = false;
        setDownloading(null);
      }
    },
    [],
  );

  const onDownloadCsv = (section: BillingReconciliationSection) => {
    if (!token) return;
    void runDownload(section, async () => ({
      blob: await downloadBillingReconciliationCsv(token, month, section),
      fileName: csvFileName(month, section),
    }));
  };

  // The whole report is already on screen: save exactly what was shown, with no second request.
  const onDownloadJson = () => {
    if (state.status !== "ready") return;
    const report: BillingReconciliationReport = state.report;
    void runDownload("json", async () => ({
      blob: new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      fileName: jsonFileName(report.month),
    }));
  };

  return (
    <ReconciliationView
      allowed={allowed}
      month={month}
      monthOptions={monthOptions}
      state={allowed ? state : { status: "loading" }}
      downloading={downloading}
      downloadError={downloadError}
      onMonthChange={(next) => {
        setDownloadError(null);
        setMonth(next);
      }}
      onRefresh={() => setReloads((count) => count + 1)}
      onDownloadCsv={onDownloadCsv}
      onDownloadJson={onDownloadJson}
    />
  );
}

export default function BillingReconciliationPage() {
  return (
    <AuthGate title="Sign in with an operator account to open the billing reconciliation report.">
      <BillingReconciliation />
    </AuthGate>
  );
}
