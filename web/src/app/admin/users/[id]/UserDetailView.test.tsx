import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../components/auth/AuthProvider", () => ({ useAuth: () => ({ signMessage: vi.fn() }) }));
vi.mock("../../../../components/ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import UserDetailView, { type UserDetailViewProps } from "./UserDetailView";
import { userDetail } from "../../../../lib/__fixtures__/adminUsers";

function render(overrides: Partial<UserDetailViewProps> = {}) {
  return renderToStaticMarkup(
    <UserDetailView
      state={{ status: "ready", detail: userDetail() }}
      isAdmin={false}
      token="token"
      onStatusChanged={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}

describe("UserDetailView (#2166)", () => {
  it("shows the identity facts", () => {
    const html = render();
    expect(html).toContain("Nova");
    expect(html).toContain("0x1234567890abcdef1234567890abcdef12345678");
    expect(html).toContain("0x9999999999999999999999999999999999999999");
    expect(html).toContain("erc4337");
    expect(html).toContain("Chain 11155111");
    expect(html).toContain("2 passkeys");
    expect(html).toContain("1 Sep 2026");
    expect(html).toContain("14 Oct 2026");
    expect(html).toContain("15 Oct 2026");
    expect(html).toContain('href="/admin/users"');
    expect(html).not.toMatch(/@/);
  });

  it("flags a possible duplicate account next to the status", () => {
    expect(render()).not.toContain("Possible duplicate");
    const html = render({ state: { status: "ready", detail: userDetail({ possibleDuplicate: true }) } });
    expect(html).toContain("Possible duplicate");
  });

  it("gives admins the suspend and close controls", () => {
    const html = render({ isAdmin: true });
    expect(html).toContain("Reason category");
    expect(html).toContain(">Suspend<");
    expect(html).toContain("Close account");
    expect(html).not.toContain("Only admins can suspend or close");
  });

  it("shows operators the status read-only, with no controls", () => {
    const html = render({ isAdmin: false });
    expect(html).toContain("Only admins can suspend or close an account.");
    expect(html).not.toContain("Reason category");
    expect(html).not.toContain("Close account");
    expect(html).not.toContain(">Suspend<");
    expect(html).not.toContain("<textarea");
  });

  it("shows a scheduled erasure on a closed account's record", () => {
    const detail = userDetail({
      accountStatus: "closed",
      status: {
        accountStatus: "closed",
        reason: "fraud",
        until: null,
        changedAt: "2026-10-12T09:00:00.000Z",
        scheduledErasureAt: "2026-11-11T09:00:00.000Z",
      },
    });
    const operator = render({ state: { status: "ready", detail }, isAdmin: false });
    expect(operator).toContain("admin-users-chip--closed");
    const admin = render({ state: { status: "ready", detail }, isAdmin: true });
    expect(admin).toContain("erasure scheduled for");
  });

  it("shows a suspended account's reason and lets an admin lift it", () => {
    const detail = userDetail({
      accountStatus: "suspended",
      status: {
        accountStatus: "suspended",
        reason: "fraud",
        until: null,
        changedAt: "2026-10-12T09:00:00.000Z",
        scheduledErasureAt: null,
      },
    });
    const html = render({ state: { status: "ready", detail }, isAdmin: true });
    expect(html).toContain("admin-users-chip--suspended");
    expect(html).toContain("Fraud");
    expect(html).toContain("No end date");
    expect(html).toContain("Lift suspension");
  });

  it("shows the activity summary and the latest items with links", () => {
    const html = render();
    expect(html).toContain("Notices received");
    expect(html).toContain("Paid 4.5 USDC");
    expect(html).toContain('href="/shows/cccccccc-0000-0000-0000-000000000001"');
    expect(html).toContain("0.0012 ETH · confirmed");
    expect(html).toContain('href="/release/r1"');
    expect(html).toContain("Night Drive");
  });

  it("explains empty activity lists", () => {
    const detail = userDetail({
      counts: { purchases: 0, pledges: 0, releases: 0 },
      activity: { recentPurchases: [], recentPledges: [], recentReleases: [], noticesReceived: 0 },
      adminActions: [],
    });
    const html = render({ state: { status: "ready", detail } });
    expect(html).toContain("No purchases yet.");
    expect(html).toContain("No pledges yet.");
    expect(html).toContain("No releases yet.");
    expect(html).toContain("Nothing has been logged for this person yet.");
  });

  it("lists operator activity on the record, newest first, with the reason category only", () => {
    const html = render();
    expect(html).toContain("Operator activity on this record");
    expect(html.indexOf("Suspended the account (Fraud)")).toBeGreaterThan(-1);
    expect(html.indexOf("Suspended the account")).toBeLessThan(html.indexOf("Opened this record"));
    expect(html).toContain("12 Oct 2026, 09:00 UTC");
    expect(html).toContain("by 0xadmi...0001");
  });

  it("copes with a person who has no wallet", () => {
    const html = render({
      state: { status: "ready", detail: userDetail({ wallet: null, walletAddress: null, artistName: null, passkeyCount: 0 }) },
    });
    expect(html).toContain("No wallet");
    expect(html).toContain("0 passkeys");
  });

  it("shows a 404 state for an unknown or erased user", () => {
    const html = render({ state: { status: "not_found" } });
    expect(html).toContain("User not found");
    expect(html).toContain('href="/admin/users"');
    expect(html).not.toContain("Identity");
  });

  it("shows a 403 state and no record", () => {
    const html = render({ state: { status: "forbidden" }, isAdmin: true });
    expect(html).toContain("Admins and operators only");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Identity");
    expect(html).not.toContain("Reason category");
  });

  it("shows loading and error states", () => {
    const loading = render({ state: { status: "loading" } });
    expect(loading).toContain("Loading user record");
    expect(loading).toContain('aria-busy="true"');
    const failed = render({ state: { status: "error", message: "Server error" } });
    expect(failed).toContain("This record could not be loaded");
    expect(failed).toContain("Server error");
    expect(failed).toContain("Try again");
  });
});
