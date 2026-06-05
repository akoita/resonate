"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../../components/auth/AuthGate";
import { useAuth } from "../../../../components/auth/AuthProvider";
import CommunityModerationDashboard from "../../../../components/admin/CommunityModerationDashboard";
import {
  getCommunityModerationQueue,
  resolveCommunityModerationReport,
  type CommunityModerationAction,
  type CommunityModerationQueueResponse,
} from "../../../../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: CommunityModerationQueueResponse }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export default function CommunityModerationAdminPage() {
  const { token, role } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [resolvingReportId, setResolvingReportId] = useState<string | null>(null);
  const canRead = role === "admin";

  const load = useCallback(async () => {
    if (!token) return;
    if (!canRead) {
      setState({ status: "forbidden" });
      return;
    }

    setState({ status: "loading" });
    try {
      const data = await getCommunityModerationQueue(token, { status: "open", limit: 50 });
      setState({ status: "ready", data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load community moderation reports.",
      });
    }
  }, [canRead, token]);

  useEffect(() => {
    let cancelled = false;

    async function loadIfActive() {
      if (!token) return;
      if (!canRead) {
        setState({ status: "forbidden" });
        return;
      }

      setState({ status: "loading" });
      try {
        const data = await getCommunityModerationQueue(token, { status: "open", limit: 50 });
        if (!cancelled) setState({ status: "ready", data });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load community moderation reports.",
          });
        }
      }
    }

    void loadIfActive();
    return () => {
      cancelled = true;
    };
  }, [canRead, token]);

  const handleResolve = useCallback(async (reportId: string, action: CommunityModerationAction) => {
    if (!token || !canRead) {
      setState({ status: "forbidden" });
      return;
    }
    setResolvingReportId(reportId);
    try {
      await resolveCommunityModerationReport(token, reportId, { action });
      const data = await getCommunityModerationQueue(token, { status: "open", limit: 50 });
      setState({ status: "ready", data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to resolve moderation report.",
      });
    } finally {
      setResolvingReportId(null);
    }
  }, [canRead, token]);

  return (
    <AuthGate title="Connect your wallet to manage community moderation.">
      {state.status === "loading" ? <CommunityModerationDashboard status="loading" /> : null}
      {state.status === "forbidden" ? <CommunityModerationDashboard status="forbidden" /> : null}
      {state.status === "error" ? (
        <CommunityModerationDashboard status="error" message={state.message} onRefresh={load} />
      ) : null}
      {state.status === "ready" ? (
        <CommunityModerationDashboard
          status="ready"
          queue={state.data}
          resolvingReportId={resolvingReportId}
          onRefresh={load}
          onResolve={handleResolve}
        />
      ) : null}
    </AuthGate>
  );
}
