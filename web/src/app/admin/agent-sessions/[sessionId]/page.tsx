"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AuthGate from "../../../../components/auth/AuthGate";
import { useAuth } from "../../../../components/auth/AuthProvider";
import { validateSessionId } from "../../../../lib/adminAgentSessions";
import { ApiRequestError, getAdminAgentSessionEvents } from "../../../../lib/api";
import SessionEventsView, { type SessionEventsState } from "./SessionEventsView";

/**
 * #2259: the raw agent events of one AI DJ session. Admin-only; the server
 * logs each time it is opened.
 */
function SessionEvents() {
  const { token, role } = useAuth();
  const params = useParams<{ sessionId: string }>();
  const sessionId = typeof params?.sessionId === "string" ? params.sessionId : "";
  const isAdmin = role === "admin";
  const valid = sessionId !== "" && validateSessionId(sessionId) === null;

  const [state, setState] = useState<SessionEventsState>({ status: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!token || !isAdmin || !valid) return;
    let cancelled = false;
    getAdminAgentSessionEvents(token, sessionId)
      .then((session) => {
        if (!cancelled) setState({ status: "ready", session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 403) setState({ status: "forbidden" });
        else if (error instanceof ApiRequestError && error.status === 404) setState({ status: "not_found" });
        else if (error instanceof ApiRequestError && error.status === 400) setState({ status: "invalid" });
        else {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, isAdmin, valid, sessionId, reloads]);

  const visibleState: SessionEventsState = !isAdmin
    ? { status: "forbidden" }
    : !valid
      ? { status: "invalid" }
      : state.status === "ready" && state.session.sessionId !== sessionId
        ? { status: "loading" }
        : state;

  return (
    <SessionEventsView
      state={visibleState}
      onRetry={() => {
        setState({ status: "loading" });
        setReloads((count) => count + 1);
      }}
    />
  );
}

export default function AdminAgentSessionEventsPage() {
  return (
    <AuthGate title="Sign in with an admin account to see a session's agent events.">
      <SessionEvents />
    </AuthGate>
  );
}
