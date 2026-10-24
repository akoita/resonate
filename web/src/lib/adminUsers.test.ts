import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADMIN_USERS_FILTERS,
  activityFilterValue,
  adminActionLabel,
  adminActionReason,
  adminUsersSearch,
  applyRestrictionResult,
  formatAssetAmount,
  formatDay,
  hasActiveFilters,
  pageCount,
  pageRange,
  parseAdminUsersFilters,
  personLabel,
  shortAddress,
  toAdminUsersRequest,
  toRestrictionAccount,
  validateSearchText,
  withActivityFilter,
} from "./adminUsers";
import { userDetail } from "./__fixtures__/adminUsers";

const parse = (search: string) => parseAdminUsersFilters(new URLSearchParams(search));

describe("admin users filters (#2166)", () => {
  it("defaults to everyone, newest first, page 1", () => {
    expect(parse("")).toEqual(DEFAULT_ADMIN_USERS_FILTERS);
    expect(adminUsersSearch(parse(""))).toBe("");
  });

  it("round-trips the URL and drops defaults", () => {
    const search = "?q=nova&status=suspended&role=artist&inactiveForDays=30&sort=lastActiveAt&order=asc&page=3";
    const filters = parse(search);
    expect(filters).toEqual({
      q: "nova",
      status: "suspended",
      role: "artist",
      inactiveForDays: 30,
      sort: "lastActiveAt",
      order: "asc",
      page: 3,
    });
    expect(new URLSearchParams(adminUsersSearch(filters))).toEqual(new URLSearchParams(search));
    expect(adminUsersSearch({ ...filters, sort: "createdAt", order: "desc", page: 1 })).not.toContain("sort=");
  });

  it("ignores values the server would reject", () => {
    expect(parse("q=a&status=banned&role=root&activeWithinDays=0&sort=email&order=sideways&page=-4")).toEqual(
      DEFAULT_ADMIN_USERS_FILTERS,
    );
    expect(parse(`q=${"x".repeat(101)}`).q).toBeUndefined();
    expect(parse("activeWithinDays=366").activeWithinDays).toBeUndefined();
  });

  it("keeps only one activity filter and resets to the first page", () => {
    const withinWeek = withActivityFilter({ ...DEFAULT_ADMIN_USERS_FILTERS, page: 4 }, "active:7");
    expect(withinWeek).toMatchObject({ activeWithinDays: 7, page: 1 });
    const quiet = withActivityFilter(withinWeek, "inactive:90");
    expect(quiet.activeWithinDays).toBeUndefined();
    expect(quiet.inactiveForDays).toBe(90);
    expect(activityFilterValue(quiet)).toBe("inactive:90");
    const cleared = withActivityFilter(quiet, "");
    expect(activityFilterValue(cleared)).toBe("");
    expect(hasActiveFilters(cleared)).toBe(false);
  });

  it("asks the API for a fixed page size", () => {
    expect(toAdminUsersRequest({ ...DEFAULT_ADMIN_USERS_FILTERS, page: 2 })).toMatchObject({ page: 2, pageSize: 25 });
  });

  it("validates the search text like the server", () => {
    expect(validateSearchText("")).toBeNull();
    expect(validateSearchText("a")).toMatch(/at least 2/);
    expect(validateSearchText("ab")).toBeNull();
    expect(validateSearchText("x".repeat(101))).toMatch(/100/);
  });

  it("counts pages and words the visible window", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
    expect(pageRange(2, 25, 25, 60)).toBe("26-50 of 60");
    expect(pageRange(1, 25, 0, 0)).toBe("0 of 0");
  });
});

describe("admin users formatting (#2166)", () => {
  it("shows dates in UTC to the day", () => {
    expect(formatDay("2026-10-15")).toBe("15 Oct 2026");
    expect(formatDay("2026-10-15T23:59:00.000Z")).toBe("15 Oct 2026");
    expect(formatDay(null)).toBe("Never");
    expect(formatDay("nonsense", "-")).toBe("-");
  });

  it("labels a person by artist name, then wallet, then id", () => {
    expect(personLabel({ id: "abcdef123456", artistName: "Nova", walletAddress: "0x1234567890abcdef1234" })).toBe("Nova");
    expect(personLabel({ id: "abcdef123456", artistName: null, walletAddress: "0x1234567890abcdef1234" })).toBe("0x1234...1234");
    expect(personLabel({ id: "abcdef123456", artistName: null, walletAddress: null })).toBe("User abcdef12");
    expect(shortAddress("0xabc")).toBe("0xabc");
  });

  it("words audit actions and shows only a reason category", () => {
    expect(adminActionLabel("account.suspended")).toBe("Suspended the account");
    expect(adminActionLabel("agent_session.events_viewed")).toBe("Opened the agent events of one of their AI DJ sessions");
    expect(adminActionLabel("something.new")).toBe("something.new");
    expect(adminActionReason({ reason: "fraud" })).toBe("Fraud");
    expect(adminActionReason({ note: "private" })).toBeNull();
    expect(adminActionReason(null)).toBeNull();
  });
});

describe("asset amounts (#2166)", () => {
  it("formats 6-decimal amounts with the symbol", () => {
    expect(formatAssetAmount("4500000", 6, "USDC")).toBe("4.5 USDC");
    expect(formatAssetAmount("1000000", 6, "USDC")).toBe("1 USDC");
    expect(formatAssetAmount("0", 6, "USDC")).toBe("0 USDC");
  });

  it("formats 18-decimal amounts with the symbol", () => {
    expect(formatAssetAmount("1200000000000000", 18, "ETH")).toBe("0.0012 ETH");
    expect(formatAssetAmount("1500000000000000000", 18, "ETH")).toBe("1.5 ETH");
  });

  it("keeps the raw text and symbol when the amount is not a whole number", () => {
    expect(formatAssetAmount("4.50", 6, "USDC")).toBe("4.50 USDC");
  });
});

describe("restriction state from a user record (#2166)", () => {
  it("uses the server's effective status as is", () => {
    const detail = userDetail({
      status: { accountStatus: "active", reason: null, until: "2026-01-01T00:00:00.000Z", changedAt: null, scheduledErasureAt: null },
    });
    expect(toRestrictionAccount(detail)).toMatchObject({ status: "active", effectiveStatus: "active" });
  });

  it("passes a scheduled erasure through to the controls", () => {
    const detail = userDetail({
      status: {
        accountStatus: "closed",
        reason: "fraud",
        until: null,
        changedAt: "2026-10-12T09:00:00.000Z",
        scheduledErasureAt: "2026-11-11T09:00:00.000Z",
      },
    });
    expect(toRestrictionAccount(detail).erasureScheduledFor).toBe("2026-11-11T09:00:00.000Z");
  });

  it("builds the account the existing controls need and folds a change back in", () => {
    const detail = userDetail();
    const account = toRestrictionAccount(detail);
    expect(account).toMatchObject({
      userId: detail.id,
      walletAddress: detail.walletAddress,
      status: "active",
      effectiveStatus: "active",
    });

    const updated = applyRestrictionResult(detail, {
      ...account,
      status: "suspended",
      effectiveStatus: "suspended",
      reason: "fraud",
      until: null,
      changedAt: "2026-10-16T10:00:00.000Z",
    });
    expect(updated.accountStatus).toBe("suspended");
    expect(updated.status).toEqual({
      accountStatus: "suspended",
      reason: "fraud",
      until: null,
      changedAt: "2026-10-16T10:00:00.000Z",
      scheduledErasureAt: null,
    });
  });
});
