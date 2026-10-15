/**
 * #2147: the suspended-account banner, the 403 message mapping and the shared
 * status store. Rendered statically (the suite has no DOM).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getOwnAccountStatus: vi.fn(),
}));

import { getOwnAccountStatus } from "./api";
import { accountRestrictionMessage } from "./accountRestriction";
import {
  describeAccountBanner,
  getAccountStatusState,
  loadAccountStatus,
  normalizeOwnAccountStatus,
  resetAccountStatus,
} from "./accountStatus";
import { AccountStatusBannerView } from "../components/account/AccountStatusBanner";

const suspended = {
  status: "suspended" as const,
  reason: "fraud" as const,
  until: "2999-01-15T12:00:00.000Z",
  changedAt: "2026-10-15T10:00:00.000Z",
  erasureScheduledFor: null,
};

afterEach(() => {
  resetAccountStatus();
  vi.clearAllMocks();
});

describe("account status banner (#2147)", () => {
  it("shows for a suspended account with the reason, the end date and what still works", () => {
    const html = renderToStaticMarkup(<AccountStatusBannerView status={suspended} />);
    expect(html).toContain("Your account is suspended until");
    expect(html).toContain("suspected fraud");
    expect(html).toContain("claim refunds");
    expect(html).toContain("/help/account-suspension");
    expect(html).toContain('data-account-status="suspended"');
  });

  it("says an indefinite suspension has no end date", () => {
    const html = renderToStaticMarkup(<AccountStatusBannerView status={{ ...suspended, until: null }} />);
    expect(html).toContain("Your account is suspended");
    expect(html).not.toContain("until");
  });

  it("shows for a closed account, including a scheduled erasure", () => {
    const html = renderToStaticMarkup(
      <AccountStatusBannerView
        status={{ ...suspended, status: "closed", until: null, erasureScheduledFor: "2999-02-01T00:00:00.000Z" }}
      />,
    );
    expect(html).toContain("Your account has been closed");
    expect(html).toContain("personal data will be erased on");
  });

  it("renders nothing for an active or unknown account", () => {
    expect(renderToStaticMarkup(<AccountStatusBannerView status={{ ...suspended, status: "active" }} />)).toBe("");
    expect(renderToStaticMarkup(<AccountStatusBannerView status={null} />)).toBe("");
    expect(describeAccountBanner(null)).toBeNull();
  });
});

describe("403 message mapping (#2147)", () => {
  it("maps account_suspended and account_closed to a clear message", () => {
    expect(accountRestrictionMessage({ code: "account_suspended", message: "x" })).toMatch(/suspended.*claim refunds/);
    expect(accountRestrictionMessage({ code: "account_suspended", until: "2999-01-15T12:00:00.000Z" })).toMatch(
      /suspended until/,
    );
    expect(accountRestrictionMessage({ code: "account_closed" })).toMatch(/closed/);
  });

  it("ignores every other error body", () => {
    expect(accountRestrictionMessage({ message: "Forbidden" })).toBeNull();
    expect(accountRestrictionMessage({ code: "other" })).toBeNull();
    expect(accountRestrictionMessage(null)).toBeNull();
    expect(accountRestrictionMessage("account_suspended")).toBeNull();
  });
});

describe("account status store", () => {
  it("loads a valid answer and keeps the previous one when a load fails or is malformed", async () => {
    vi.mocked(getOwnAccountStatus).mockResolvedValueOnce(suspended);
    await loadAccountStatus("tok");
    expect(getAccountStatusState().status?.status).toBe("suspended");

    vi.mocked(getOwnAccountStatus).mockRejectedValueOnce(new Error("boom"));
    await loadAccountStatus("tok");
    expect(getAccountStatusState().status?.status).toBe("suspended");

    vi.mocked(getOwnAccountStatus).mockResolvedValueOnce([] as never);
    await loadAccountStatus("tok");
    expect(getAccountStatusState().status?.status).toBe("suspended");
  });

  it("clears on sign-out and rejects unknown statuses", async () => {
    vi.mocked(getOwnAccountStatus).mockResolvedValueOnce(suspended);
    await loadAccountStatus("tok");
    await loadAccountStatus(null);
    expect(getAccountStatusState().status).toBeNull();
    expect(normalizeOwnAccountStatus({ status: "banished" })).toBeNull();
  });
});
