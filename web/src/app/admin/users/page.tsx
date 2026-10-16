"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  ApiRequestError,
  getAdminUsersOverview,
  listAdminUsers,
  type AdminUsersOverview,
} from "../../../lib/api";
import {
  adminUsersSearch,
  parseAdminUsersFilters,
  toAdminUsersRequest,
  validateSearchText,
  type AdminUsersFilters,
} from "../../../lib/adminUsers";
import UsersView, { type UsersListState, type UsersOverviewState } from "./UsersView";

/**
 * #2166: the operator users directory. Admins and operators can look people up
 * and open their record; the server enforces the same rule. The filters live in
 * the URL so a view can be shared and the back button works.
 */
function UsersDirectory() {
  const { token, role } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canView = role === "admin" || role === "operator";

  const filters = useMemo(() => parseAdminUsersFilters(searchParams), [searchParams]);
  const filtersKey = adminUsersSearch(filters);

  const [searchText, setSearchText] = useState(filters.q ?? "");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [syncedQuery, setSyncedQuery] = useState(filters.q ?? "");
  if ((filters.q ?? "") !== syncedQuery) {
    // The URL changed (back button, clear): show what was actually searched.
    setSyncedQuery(filters.q ?? "");
    setSearchText(filters.q ?? "");
    setSearchError(null);
  }

  const [overview, setOverview] = useState<UsersOverviewState>({ status: "loading" });
  const [reloads, setReloads] = useState(0);
  // The latest answer and the request it answered. While a newer request is in
  // flight the previous page stays on screen (marked refreshing).
  const [loaded, setLoaded] = useState<{ key: string; state: UsersListState } | null>(null);
  const requestKey = `${filtersKey}|${reloads}`;

  useEffect(() => {
    if (!token || !canView) return;
    let cancelled = false;
    getAdminUsersOverview(token)
      .then((result: AdminUsersOverview) => {
        if (!cancelled) setOverview({ status: "ready", overview: result });
      })
      .catch(() => {
        if (!cancelled) setOverview({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token, canView, reloads]);

  useEffect(() => {
    if (!token || !canView) return;
    let cancelled = false;
    const request = toAdminUsersRequest(parseAdminUsersFilters(new URLSearchParams(filtersKey)));
    const finish = (state: UsersListState) => {
      if (!cancelled) setLoaded({ key: requestKey, state });
    };
    listAdminUsers(token, request)
      .then((page) => finish({ status: "ready", page }))
      .catch((error: unknown) => {
        if (error instanceof ApiRequestError && error.status === 403) {
          finish({ status: "forbidden" });
          return;
        }
        finish({
          status: "error",
          message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, canView, filtersKey, requestKey]);

  const visibleList: UsersListState = !canView
    ? { status: "forbidden" }
    : loaded?.key === requestKey
      ? loaded.state
      : loaded?.state.status === "ready"
        ? { ...loaded.state, refreshing: true }
        : { status: "loading" };

  const applyFilters = (next: AdminUsersFilters) => {
    const search = adminUsersSearch(next);
    router.replace(`${pathname}${search}`, { scroll: false });
  };

  const submitSearch = () => {
    const problem = validateSearchText(searchText);
    setSearchError(problem);
    if (problem) return;
    const q = searchText.trim();
    applyFilters({ ...filters, q: q || undefined, page: 1 });
  };

  return (
    <UsersView
      list={visibleList}
      overview={overview}
      filters={filters}
      searchText={searchText}
      searchError={searchError}
      onSearchTextChange={(value) => {
        setSearchText(value);
        setSearchError(null);
      }}
      onSearchSubmit={submitSearch}
      onFiltersChange={applyFilters}
      onClearFilters={() => {
        setSearchText("");
        setSearchError(null);
        applyFilters({ ...filters, q: undefined, status: undefined, role: undefined, activeWithinDays: undefined, inactiveForDays: undefined, page: 1 });
      }}
      onRetry={() => setReloads((count) => count + 1)}
    />
  );
}

export default function AdminUsersPage() {
  return (
    <AuthGate title="Sign in with an admin or operator account to see users.">
      <Suspense fallback={<p role="status">Loading users...</p>}>
        <UsersDirectory />
      </Suspense>
    </AuthGate>
  );
}
