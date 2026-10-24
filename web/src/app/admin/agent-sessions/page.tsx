"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { validateSessionId } from "../../../lib/adminAgentSessions";
import SessionLookupView from "./SessionLookupView";

/** #2259: admin-only lookup of one AI DJ session's raw agent events. */
function SessionLookup() {
  const { role } = useAuth();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const problem = validateSessionId(value);
    setError(problem);
    if (problem) return;
    router.push(`/admin/agent-sessions/${encodeURIComponent(value.trim())}`);
  };

  return (
    <SessionLookupView
      allowed={role === "admin"}
      value={value}
      error={error}
      onValueChange={(next) => {
        setValue(next);
        setError(null);
      }}
      onSubmit={submit}
    />
  );
}

export default function AdminAgentSessionsPage() {
  return (
    <AuthGate title="Sign in with an admin account to see a session's agent events.">
      <SessionLookup />
    </AuthGate>
  );
}
