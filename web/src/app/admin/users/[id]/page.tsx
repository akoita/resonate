"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AuthGate from "../../../../components/auth/AuthGate";
import { useAuth } from "../../../../components/auth/AuthProvider";
import {
  ApiRequestError,
  getAdminUser,
  type AdminAccountStatus,
} from "../../../../lib/api";
import { applyRestrictionResult } from "../../../../lib/adminUsers";
import UserDetailView, { type UserDetailState } from "./UserDetailView";

/**
 * #2166: one person's record. Admins and operators can read it (the server
 * logs each time it is opened); only admins get the suspend / close controls.
 */
function UserDetail() {
  const { token, role } = useAuth();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const canView = role === "admin" || role === "operator";
  const isAdmin = role === "admin";

  const [state, setState] = useState<UserDetailState>({ status: "loading" });
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!token || !canView || !id) return;
    let cancelled = false;
    getAdminUser(token, id)
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 403) setState({ status: "forbidden" });
        else if (error instanceof ApiRequestError && error.status === 404) setState({ status: "not_found" });
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
  }, [token, canView, id, reloads]);

  const visibleState: UserDetailState = !canView
    ? { status: "forbidden" }
    : !id
      ? { status: "not_found" }
      : state.status === "ready" && state.detail.id !== id
        ? { status: "loading" }
        : state;

  const onStatusChanged = (updated: AdminAccountStatus) => {
    // Show the new state at once, then reload so the log shows the change too.
    setState((previous) =>
      previous.status === "ready" ? { status: "ready", detail: applyRestrictionResult(previous.detail, updated) } : previous,
    );
    setReloads((count) => count + 1);
  };

  return (
    <UserDetailView
      state={visibleState}
      isAdmin={isAdmin}
      token={token}
      onStatusChanged={onStatusChanged}
      onRecordChanged={() => setReloads((count) => count + 1)}
      onRetry={() => {
        setState({ status: "loading" });
        setReloads((count) => count + 1);
      }}
    />
  );
}

export default function AdminUserDetailPage() {
  return (
    <AuthGate title="Sign in with an admin or operator account to see this user.">
      <UserDetail />
    </AuthGate>
  );
}
