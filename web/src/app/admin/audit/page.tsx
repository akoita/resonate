"use client";

import { useEffect, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { ADMIN_AUDIT_PAGE_SIZE } from "../../../lib/adminAudit";
import { ApiRequestError, listAdminAuditEvents } from "../../../lib/api";
import AuditLogView, { type AuditLogFilters, type AuditLogState } from "./AuditLogView";

/** #2173: the admin audit log. Admin only; the server enforces the same rule. */
function AuditLog() {
  const { token, role } = useAuth();
  const allowed = role === "admin";
  const [filters, setFilters] = useState<AuditLogFilters>({ page: 1 });
  const [reloads, setReloads] = useState(0);
  // The latest answer and the request it answered; the previous page stays up while a newer one loads.
  const [loaded, setLoaded] = useState<{ key: string; state: AuditLogState } | null>(null);
  const key = `${filters.action ?? ""}|${filters.outcome ?? ""}|${filters.page}|${reloads}`;

  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    const finish = (state: AuditLogState) => {
      if (!cancelled) setLoaded({ key, state });
    };
    listAdminAuditEvents(token, {
      action: filters.action,
      outcome: filters.outcome,
      page: filters.page,
      pageSize: ADMIN_AUDIT_PAGE_SIZE,
    })
      .then((page) => finish({ status: "ready", page }))
      .catch((error: unknown) => {
        finish({
          status: "error",
          message:
            error instanceof ApiRequestError && error.status === 403
              ? "Your account does not have access to the admin audit log."
              : error instanceof Error
                ? error.message
                : "Something went wrong. Please try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, allowed, filters.action, filters.outcome, filters.page, key]);

  const state: AuditLogState =
    loaded?.key === key
      ? loaded.state
      : loaded?.state.status === "ready"
        ? { ...loaded.state, refreshing: true }
        : { status: "loading" };

  return (
    <AuditLogView
      allowed={allowed}
      state={state}
      filters={filters}
      onFiltersChange={setFilters}
      onRetry={() => setReloads((count) => count + 1)}
    />
  );
}

export default function AdminAuditPage() {
  return (
    <AuthGate title="Sign in with an admin account to see the admin audit log.">
      <AuditLog />
    </AuthGate>
  );
}
