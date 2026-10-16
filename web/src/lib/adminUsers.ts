import type {
  AccountStatusReason,
  AccountStatusValue,
  AdminAccountStatus,
  AdminUserDetail,
  AdminUserOrder,
  AdminUserRole,
  AdminUserRoleFilter,
  AdminUserSort,
  AdminUsersQuery,
} from "./api";
import { buildAdminUsersQueryString } from "./api";
import { formatPaymentAmountWithSymbol } from "./payments";

/**
 * #2166: pure helpers for the operator users directory: the URL <-> filter
 * round trip, the labels, and the date formats. No React and no network.
 */

export const ADMIN_USERS_PAGE_SIZE = 25;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;

export const STATUS_OPTIONS: ReadonlyArray<{ value: AccountStatusValue; label: string }> = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
];

export const ROLE_OPTIONS: ReadonlyArray<{ value: AdminUserRoleFilter; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "agent", label: "Agent" },
  { value: "artist", label: "Artist" },
  { value: "listener", label: "Listener only" },
];

export const SORT_OPTIONS: ReadonlyArray<{ value: AdminUserSort; label: string }> = [
  { value: "createdAt", label: "Joined" },
  { value: "lastActiveAt", label: "Last active" },
  { value: "lastSignInAt", label: "Last sign-in" },
];

export const ORDER_OPTIONS: ReadonlyArray<{ value: AdminUserOrder; label: string }> = [
  { value: "desc", label: "Newest first" },
  { value: "asc", label: "Oldest first" },
];

/** One select for the two activity filters: they cannot be combined. */
export const ACTIVITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Any activity" },
  { value: "active:1", label: "Active in the last day" },
  { value: "active:7", label: "Active in the last 7 days" },
  { value: "active:30", label: "Active in the last 30 days" },
  { value: "active:90", label: "Active in the last 90 days" },
  { value: "inactive:30", label: "No activity for 30 days" },
  { value: "inactive:90", label: "No activity for 90 days" },
  { value: "inactive:180", label: "No activity for 180 days" },
];

const STATUS_VALUES = STATUS_OPTIONS.map((option) => option.value) as string[];
const ROLE_VALUES = ROLE_OPTIONS.map((option) => option.value) as string[];
const SORT_VALUES = SORT_OPTIONS.map((option) => option.value) as string[];

/** The filters a page needs a value for; sort, order and page always have one. */
export type AdminUsersFilters = AdminUsersQuery & {
  sort: AdminUserSort;
  order: AdminUserOrder;
  page: number;
};

export const DEFAULT_ADMIN_USERS_FILTERS: AdminUsersFilters = { sort: "createdAt", order: "desc", page: 1 };

function positiveInt(value: string | null, max: number): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= max ? parsed : undefined;
}

/** Reads the page URL into filters, ignoring anything the server would reject. */
export function parseAdminUsersFilters(params: { get(name: string): string | null }): AdminUsersFilters {
  const filters: AdminUsersFilters = { ...DEFAULT_ADMIN_USERS_FILTERS };
  const q = params.get("q")?.trim();
  if (q && q.length >= SEARCH_MIN && q.length <= SEARCH_MAX) filters.q = q;
  const status = params.get("status");
  if (status && STATUS_VALUES.includes(status)) filters.status = status as AccountStatusValue;
  const role = params.get("role");
  if (role && ROLE_VALUES.includes(role)) filters.role = role as AdminUserRoleFilter;
  const within = positiveInt(params.get("activeWithinDays"), 365);
  const inactive = positiveInt(params.get("inactiveForDays"), 365);
  if (within) filters.activeWithinDays = within;
  else if (inactive) filters.inactiveForDays = inactive;
  const sort = params.get("sort");
  if (sort && SORT_VALUES.includes(sort)) filters.sort = sort as AdminUserSort;
  if (params.get("order") === "asc") filters.order = "asc";
  filters.page = positiveInt(params.get("page"), 100000) ?? 1;
  return filters;
}

/** The URL query for the page: defaults are left out so a clean URL means "everyone". */
export function adminUsersSearch(filters: AdminUsersFilters): string {
  return buildAdminUsersQueryString({
    q: filters.q,
    status: filters.status,
    role: filters.role,
    activeWithinDays: filters.activeWithinDays,
    inactiveForDays: filters.inactiveForDays,
    sort: filters.sort === DEFAULT_ADMIN_USERS_FILTERS.sort ? undefined : filters.sort,
    order: filters.order === DEFAULT_ADMIN_USERS_FILTERS.order ? undefined : filters.order,
    page: filters.page > 1 ? filters.page : undefined,
  });
}

/** The API request for the same filters. */
export function toAdminUsersRequest(filters: AdminUsersFilters): AdminUsersQuery {
  return { ...filters, pageSize: ADMIN_USERS_PAGE_SIZE };
}

export function activityFilterValue(filters: AdminUsersQuery): string {
  if (filters.activeWithinDays) return `active:${filters.activeWithinDays}`;
  if (filters.inactiveForDays) return `inactive:${filters.inactiveForDays}`;
  return "";
}

/** Applies the activity select's value, clearing the other activity filter. */
export function withActivityFilter(filters: AdminUsersFilters, value: string): AdminUsersFilters {
  const next: AdminUsersFilters = { ...filters, page: 1 };
  delete next.activeWithinDays;
  delete next.inactiveForDays;
  const match = /^(active|inactive):(\d+)$/.exec(value);
  if (!match) return next;
  const days = Number(match[2]);
  if (match[1] === "active") next.activeWithinDays = days;
  else next.inactiveForDays = days;
  return next;
}

export function hasActiveFilters(filters: AdminUsersFilters): boolean {
  return Boolean(
    filters.q || filters.status || filters.role || filters.activeWithinDays || filters.inactiveForDays,
  );
}

/** Returns an inline message when the search box value would be rejected. */
export function validateSearchText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length < SEARCH_MIN) return `Type at least ${SEARCH_MIN} characters.`;
  if (trimmed.length > SEARCH_MAX) return `Keep the search to ${SEARCH_MAX} characters.`;
  return null;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** "26-50 of 123" for the visible window. */
export function pageRange(page: number, pageSize: number, itemCount: number, total: number): string {
  if (itemCount === 0) return `0 of ${total}`;
  const start = (page - 1) * pageSize + 1;
  return `${start}-${start + itemCount - 1} of ${total}`;
}

export function roleLabel(role: AdminUserRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function statusLabel(status: AccountStatusValue): string {
  return status === "active" ? "Active" : status === "suspended" ? "Suspended" : "Closed";
}

/** "0x1234...abcd"; short values are returned whole. */
export function shortAddress(value: string | null | undefined): string {
  if (!value) return "No wallet";
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

/** A person's best label: artist name, then wallet, then a short id. */
export function personLabel(row: { artistName: string | null; walletAddress: string | null; id: string }): string {
  return row.artistName?.trim() || (row.walletAddress ? shortAddress(row.walletAddress) : `User ${row.id.slice(0, 8)}`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcDay(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "15 Oct 2026" from an ISO date or "YYYY-MM-DD"; the fallback when missing. Always UTC. */
export function formatDay(value: string | null | undefined, fallback = "Never"): string {
  if (!value) return fallback;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return fallback;
  return utcDay(date);
}

/** "15 Oct 2026, 14:03 UTC". */
export function formatDateTime(value: string | null | undefined, fallback = "Unknown"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${utcDay(date)}, ${hours}:${minutes} UTC`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const ADMIN_ACTION_LABELS: Record<string, string> = {
  "user.detail_viewed": "Opened this record",
  "account.suspended": "Suspended the account",
  "account.unsuspended": "Lifted the suspension",
  "account.closed": "Closed the account",
};

/** A plain label for an audit action; unknown actions are shown as recorded. */
export function adminActionLabel(action: string): string {
  return ADMIN_ACTION_LABELS[action] ?? action;
}

const REASON_LABELS: Record<string, string> = {
  terms_violation: "Terms violation",
  fraud: "Fraud",
  abuse: "Abuse",
  rights_infringement: "Rights infringement",
  other: "Other",
};

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REASON_LABELS[reason] ?? reason;
}

/** The reason category kept with an audit event, if it has one (never a note). */
export function adminActionReason(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const reason = (detail as { reason?: unknown }).reason;
  return typeof reason === "string" ? reasonLabel(reason) : null;
}

/**
 * The shape the existing restriction controls (#2147) work on, built from the
 * user record so the controls need no second lookup. `status.accountStatus` is
 * already the effective status (the server applies suspension expiry). Who made
 * the last change is not part of the record, so it stays empty.
 */
export function toRestrictionAccount(detail: AdminUserDetail): AdminAccountStatus {
  return {
    userId: detail.id,
    walletAddress: detail.walletAddress,
    status: detail.status.accountStatus,
    effectiveStatus: detail.status.accountStatus,
    reason: (detail.status.reason as AccountStatusReason | null) ?? null,
    until: detail.status.until,
    changedAt: detail.status.changedAt,
    changedBy: null,
    erasureScheduledFor: detail.status.scheduledErasureAt,
  };
}

/** Folds the result of a suspend, lift or close back into the user record. */
export function applyRestrictionResult(detail: AdminUserDetail, updated: AdminAccountStatus): AdminUserDetail {
  return {
    ...detail,
    accountStatus: updated.status,
    status: {
      accountStatus: updated.effectiveStatus,
      reason: updated.reason,
      until: updated.until,
      changedAt: updated.changedAt,
      scheduledErasureAt: updated.erasureScheduledFor,
    },
  };
}

/**
 * "4.5 USDC" / "0.0012 ETH" from a base-unit string and the asset's decimals.
 * Falls back to the raw text, still with the symbol, if it is not a whole number.
 */
export function formatAssetAmount(units: string, decimals: number, symbol: string): string {
  try {
    return formatPaymentAmountWithSymbol(units, decimals, symbol);
  } catch {
    return `${units} ${symbol}`.trim();
  }
}
