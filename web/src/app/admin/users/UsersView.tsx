"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import {
  ReviewQueueHeader,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../components/admin/review-queue/ReviewQueue";
import { Button } from "../../../components/ui/Button";
import type {
  AccountStatusValue,
  AdminUserOrder,
  AdminUserRoleFilter,
  AdminUserRow,
  AdminUserSort,
  AdminUsersOverview,
  AdminUsersPage,
} from "../../../lib/api";
import {
  ACTIVITY_OPTIONS,
  ADMIN_USERS_PAGE_SIZE,
  ORDER_OPTIONS,
  ROLE_OPTIONS,
  SEARCH_MAX,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  activityFilterValue,
  formatDateTime,
  formatDay,
  hasActiveFilters,
  pageCount,
  pageRange,
  personLabel,
  roleLabel,
  shortAddress,
  statusLabel,
  withActivityFilter,
  type AdminUsersFilters,
} from "../../../lib/adminUsers";

export type UsersListState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string }
  | { status: "ready"; page: AdminUsersPage; refreshing?: boolean };

export type UsersOverviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; overview: AdminUsersOverview };

export type UsersViewProps = {
  list: UsersListState;
  overview: UsersOverviewState;
  filters: AdminUsersFilters;
  searchText: string;
  searchError: string | null;
  onSearchTextChange: (value: string) => void;
  onSearchSubmit: () => void;
  onFiltersChange: (next: AdminUsersFilters) => void;
  onClearFilters: () => void;
  onRetry: () => void;
};

function Tile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="admin-users-tile">
      <p className="admin-users-tile__label">{label}</p>
      <p className="admin-users-tile__value">{value.toLocaleString("en-GB")}</p>
      {sub ? <p className="admin-users-tile__sub">{sub}</p> : null}
    </div>
  );
}

export function UsersOverviewTiles({ state }: { state: UsersOverviewState }) {
  if (state.status === "loading") {
    return (
      <section aria-label="Overview" aria-busy="true">
        <p className="admin-users-note" role="status">Loading overview...</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section aria-label="Overview">
        <p className="admin-users-note" role="status">The overview could not be loaded. The list below still works.</p>
      </section>
    );
  }
  const { overview } = state;
  return (
    <section aria-label="Overview" style={{ display: "grid", gap: "8px" }}>
      <div className="admin-users-tiles">
        <Tile label="People" value={overview.totalUsers} />
        <Tile label="New in 7 days" value={overview.newUsers.d7} sub={`${overview.newUsers.d30.toLocaleString("en-GB")} in 30 days`} />
        <Tile label="Active in 24 hours" value={overview.activeUsers.d1} />
        <Tile label="Active in 7 days" value={overview.activeUsers.d7} sub={`${overview.activeUsers.d30.toLocaleString("en-GB")} in 30 days`} />
        <Tile label="Suspended" value={overview.suspended} />
        <Tile label="Closed" value={overview.closed} />
      </div>
      <p className="admin-users-note">
        As of {formatDateTime(overview.generatedAt)}. Erased accounts are not counted. A person counts as active when
        they signed in or used the app; this is recorded at most once an hour.
      </p>
    </section>
  );
}

function Options<T extends string>({ options }: { options: ReadonlyArray<{ value: T; label: string }> }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </>
  );
}

export function UsersFilters({
  filters,
  searchText,
  searchError,
  onSearchTextChange,
  onSearchSubmit,
  onFiltersChange,
  onClearFilters,
}: Pick<
  UsersViewProps,
  "filters" | "searchText" | "searchError" | "onSearchTextChange" | "onSearchSubmit" | "onFiltersChange" | "onClearFilters"
>) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearchSubmit();
  };
  const change = (patch: Partial<AdminUsersFilters>) => onFiltersChange({ ...filters, ...patch, page: 1 });
  const active = hasActiveFilters(filters);
  return (
    <section className="admin-users-filters" aria-label="Find people">
      <form className="admin-users-search" onSubmit={submit} role="search">
        <label className="admin-users-field">
          <span>Search by user id, wallet address or artist name</span>
          <input
            type="search"
            value={searchText}
            maxLength={SEARCH_MAX}
            placeholder="0x..., user id or artist name"
            aria-invalid={searchError ? true : undefined}
            aria-describedby={searchError ? "admin-users-search-error" : undefined}
            onChange={(event) => onSearchTextChange(event.target.value)}
          />
        </label>
        <Button type="submit" variant="primary">Search</Button>
      </form>
      {searchError ? <p id="admin-users-search-error" className="admin-users-error" role="alert">{searchError}</p> : null}
      <div className="admin-users-selects">
        <label className="admin-users-field">
          <span>Status</span>
          <select
            aria-label="Status"
            value={filters.status ?? ""}
            onChange={(event) => change({ status: (event.target.value || undefined) as AccountStatusValue | undefined })}
          >
            <option value="">Any status</option>
            <Options options={STATUS_OPTIONS} />
          </select>
        </label>
        <label className="admin-users-field">
          <span>Role</span>
          <select
            aria-label="Role"
            value={filters.role ?? ""}
            onChange={(event) => change({ role: (event.target.value || undefined) as AdminUserRoleFilter | undefined })}
          >
            <option value="">Any role</option>
            <Options options={ROLE_OPTIONS} />
          </select>
        </label>
        <label className="admin-users-field">
          <span>Activity</span>
          <select
            aria-label="Activity"
            value={activityFilterValue(filters)}
            onChange={(event) => onFiltersChange(withActivityFilter(filters, event.target.value))}
          >
            <Options options={ACTIVITY_OPTIONS} />
          </select>
        </label>
        <label className="admin-users-field">
          <span>Sort by</span>
          <select
            aria-label="Sort by"
            value={filters.sort}
            onChange={(event) => change({ sort: event.target.value as AdminUserSort })}
          >
            <Options options={SORT_OPTIONS} />
          </select>
        </label>
        <label className="admin-users-field">
          <span>Order</span>
          <select
            aria-label="Order"
            value={filters.order}
            onChange={(event) => change({ order: event.target.value as AdminUserOrder })}
          >
            <Options options={ORDER_OPTIONS} />
          </select>
        </label>
      </div>
      {active ? (
        <div className="admin-users-filters__footer">
          <Button variant="ghost" onClick={onClearFilters}>Clear filters</Button>
        </div>
      ) : null}
    </section>
  );
}

function StatusChip({ status }: { status: AccountStatusValue }) {
  return <span className={`admin-users-chip admin-users-chip--${status}`}>{statusLabel(status)}</span>;
}

export function RoleChips({ roles }: { roles: AdminUserRow["roles"] }) {
  if (roles.length === 0) return <span className="admin-users-muted">Listener</span>;
  return (
    <span className="admin-users-chips">
      {roles.map((role) => (
        <span key={role} className="admin-users-chip">{roleLabel(role)}</span>
      ))}
    </span>
  );
}

export { StatusChip };

export function UsersTable({ items }: { items: AdminUserRow[] }) {
  return (
    <table className="admin-users-table">
      <caption className="visually-hidden">People on the platform</caption>
      <thead>
        <tr>
          <th scope="col">Person</th>
          <th scope="col">Roles</th>
          <th scope="col">Status</th>
          <th scope="col">Joined</th>
          <th scope="col">Last sign-in</th>
          <th scope="col">Last active</th>
          <th scope="col" className="is-num">Purchases</th>
          <th scope="col" className="is-num">Pledges</th>
          <th scope="col" className="is-num">Releases</th>
        </tr>
      </thead>
      <tbody>
        {items.map((row) => (
          <tr key={row.id}>
            <td className="admin-users-cell--person" data-label="Person">
              <span className="admin-users-person">
                <Link href={`/admin/users/${encodeURIComponent(row.id)}`} prefetch={false}>{personLabel(row)}</Link>
                <span className="admin-users-person__sub">
                  {row.artistName && row.walletAddress ? `${shortAddress(row.walletAddress)} · ` : ""}
                  {row.id.slice(0, 8)}
                </span>
              </span>
            </td>
            <td data-label="Roles"><RoleChips roles={row.roles} /></td>
            <td data-label="Status"><StatusChip status={row.accountStatus} /></td>
            <td data-label="Joined">{formatDay(row.createdAt)}</td>
            <td data-label="Last sign-in">{formatDay(row.lastSignInAt)}</td>
            <td data-label="Last active">{formatDay(row.lastActiveDay)}</td>
            <td className="is-num" data-label="Purchases">{row.counts.purchases}</td>
            <td className="is-num" data-label="Pledges">{row.counts.pledges}</td>
            <td className="is-num" data-label="Releases">{row.counts.releases}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsersPager({
  page,
  onPage,
}: {
  page: AdminUsersPage;
  onPage: (next: number) => void;
}) {
  const pages = pageCount(page.total, page.pageSize || ADMIN_USERS_PAGE_SIZE);
  return (
    <nav className="admin-users-pager" aria-label="Pagination">
      <span>
        Showing {pageRange(page.page, page.pageSize, page.items.length, page.total)} · Page {page.page} of {pages}
      </span>
      <span className="admin-users-pager__buttons">
        <Button variant="ghost" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>Previous</Button>
        <Button variant="ghost" disabled={page.page >= pages} onClick={() => onPage(page.page + 1)}>Next</Button>
      </span>
    </nav>
  );
}

export function UsersResults({
  list,
  filters,
  onFiltersChange,
  onClearFilters,
  onRetry,
}: Pick<UsersViewProps, "list" | "filters" | "onFiltersChange" | "onClearFilters" | "onRetry">) {
  if (list.status === "loading") {
    return (
      <section className="admin-users-results" aria-busy="true" aria-label="People">
        <p className="visually-hidden" role="status">Loading people...</p>
        <div className="admin-users-skeleton" aria-hidden="true">
          <span /><span /><span /><span />
        </div>
      </section>
    );
  }
  if (list.status === "error") {
    return (
      <ReviewQueueStatePanel
        variant="error"
        heading="People could not be loaded"
        body={list.message}
        actionLabel="Try again"
        onAction={onRetry}
      />
    );
  }
  if (list.status === "forbidden") return null;
  const { page } = list;
  if (page.items.length === 0 && page.total === 0) {
    return hasActiveFilters(filters) ? (
      <ReviewQueueStatePanel
        variant="empty"
        heading="No one matches these filters"
        body="Try a different search, or clear the filters to see everyone."
        actionLabel="Clear filters"
        onAction={onClearFilters}
      />
    ) : (
      <ReviewQueueStatePanel variant="empty" heading="No users yet" body="People appear here once they sign in." />
    );
  }
  if (page.items.length === 0) {
    return (
      <ReviewQueueStatePanel
        variant="empty"
        heading="That page is empty"
        body={`There are ${page.total.toLocaleString("en-GB")} people for these filters, but not this far in.`}
        actionLabel="Back to the first page"
        onAction={() => onFiltersChange({ ...filters, page: 1 })}
      />
    );
  }
  return (
    <section className="admin-users-results" aria-label="People" aria-busy={list.refreshing ? "true" : undefined}>
      <UsersTable items={page.items} />
      <UsersPager page={page} onPage={(next) => onFiltersChange({ ...filters, page: next })} />
    </section>
  );
}

/**
 * #2166: the operator users directory. Presentation only: the page owns the
 * data, the URL and the auth gate, so every state is renderable on its own.
 */
export default function UsersView(props: UsersViewProps) {
  const { list } = props;
  return (
    <ReviewQueuePage className="admin-users-page">
      <ReviewQueueHeader
        eyebrow="Operations"
        title="Users"
        description="Find a person, see when they last used the app and what they have done, and open their record. Suspending or closing an account is done from a person's record and needs an admin."
      />
      {list.status === "forbidden" ? (
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Admins and operators only"
          body="Your account does not have access to the users directory."
        />
      ) : (
        <>
          <UsersOverviewTiles state={props.overview} />
          <UsersFilters {...props} />
          <UsersResults {...props} />
        </>
      )}
    </ReviewQueuePage>
  );
}
