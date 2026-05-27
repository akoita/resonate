"use client";

import { useCallback, useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import AgentQualityDashboard from "../../../components/analytics/AgentQualityDashboard";
import {
  getAgentQualityDashboard,
  type AgentQualityDashboard as AgentQualityDashboardData,
} from "../../../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: AgentQualityDashboardData }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export default function AgentQualityAnalyticsPage() {
  const { token, role } = useAuth();
  const [days, setDays] = useState(30);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const canRead = role === "admin" || role === "operator";

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    if (!canRead) {
      setState({ status: "forbidden" });
      return;
    }

    setState({ status: "loading" });
    try {
      const data = await getAgentQualityDashboard(token, days);
      setState({ status: "ready", data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load AI DJ quality metrics.",
      });
    }
  }, [canRead, days, token]);

  useEffect(() => {
    let cancelled = false;

    async function loadIfActive() {
      if (!token) {
        return;
      }
      if (!canRead) {
        setState({ status: "forbidden" });
        return;
      }

      setState({ status: "loading" });
      try {
        const data = await getAgentQualityDashboard(token, days);
        if (!cancelled) {
          setState({ status: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to load AI DJ quality metrics.",
          });
        }
      }
    }

    void loadIfActive();
    return () => {
      cancelled = true;
    };
  }, [canRead, days, token]);

  return (
    <AuthGate title="Connect your wallet to view AI DJ quality analytics.">
      {state.status === "loading" ? (
        <AgentQualityDashboard status="loading" days={days} onDaysChange={setDays} />
      ) : null}
      {state.status === "error" ? (
        <AgentQualityDashboard
          status="error"
          days={days}
          message={state.message}
          onRetry={load}
          onDaysChange={setDays}
        />
      ) : null}
      {state.status === "forbidden" ? (
        <AgentQualityDashboard status="forbidden" days={days} onDaysChange={setDays} />
      ) : null}
      {state.status === "ready" ? (
        <AgentQualityDashboard status="ready" days={days} data={state.data} onDaysChange={setDays} />
      ) : null}
    </AuthGate>
  );
}
