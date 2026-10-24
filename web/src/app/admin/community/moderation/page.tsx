"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../../components/auth/AuthGate";
import { useAuth } from "../../../../components/auth/AuthProvider";
import CommunityModerationDashboard from "../../../../components/admin/CommunityModerationDashboard";
import { useToast } from "../../../../components/ui/Toast";
import { AdminStepUpCancelledError, withAdminStepUp } from "../../../../lib/adminStepUp";
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
  const { token, role, signMessage } = useAuth();
  const { addToast } = useToast();
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
      // Removing a message or a member is destructive: it needs a fresh passkey confirmation (#2362).
      await withAdminStepUp(
        {
          token,
          signMessage,
          onPrompt: () =>
            addToast({
              type: "info",
              title: "Confirm it is you",
              message: "Your passkey will ask you to confirm this moderation action.",
            }),
        },
        (proof) => resolveCommunityModerationReport(token, reportId, { action }, proof),
      );
      const data = await getCommunityModerationQueue(token, { status: "open", limit: 50 });
      setState({ status: "ready", data });
    } catch (error) {
      if (error instanceof AdminStepUpCancelledError) {
        // The passkey prompt was dismissed: nothing was sent, so the queue stays as it was.
        addToast({ type: "info", title: "Nothing changed", message: error.message });
        return;
      }
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to resolve moderation report.",
      });
    } finally {
      setResolvingReportId(null);
    }
  }, [addToast, canRead, signMessage, token]);

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
