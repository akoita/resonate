import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountRestrictionPanel, {
  EMPTY_RESTRICTION_DRAFT,
  getRestrictionConfirmCopy,
  toRestrictionInput,
  validateRestrictionDraft,
} from "./AccountRestrictionPanel";
import type { AdminAccountStatus } from "../../../lib/api";

const account: AdminAccountStatus = {
  userId: "user-1",
  walletAddress: "0xabc",
  status: "active",
  effectiveStatus: "active",
  reason: null,
  until: null,
  changedAt: null,
  changedBy: null,
  erasureScheduledFor: null,
};

function render(overrides: Partial<AdminAccountStatus> = {}) {
  return renderToStaticMarkup(
    <AccountRestrictionPanel
      account={{ ...account, ...overrides }}
      draft={EMPTY_RESTRICTION_DRAFT}
      errors={{}}
      busy={false}
      onChange={() => {}}
      onRequest={() => {}}
    />,
  );
}

describe("admin account controls (#2147)", () => {
  it("offers suspend and close with a reason select for an active account", () => {
    const html = render();
    expect(html).toContain("Reason category");
    expect(html).toContain("Terms violation");
    expect(html).toContain(">Suspend<");
    expect(html).toContain("Close account");
    expect(html).not.toContain("Lift suspension");
    expect(html).toContain("never shown to the person");
  });

  it("offers lifting a suspension on a suspended account", () => {
    const html = render({ status: "suspended", effectiveStatus: "suspended", reason: "abuse" });
    expect(html).toContain("Lift suspension");
    expect(html).toContain("Suspended - abusive behaviour");
  });

  it("offers nothing to change on a closed account", () => {
    const html = render({ status: "closed", effectiveStatus: "closed", reason: "fraud" });
    expect(html).toContain("nothing more to change");
    expect(html).not.toContain("Close account");
  });

  it("builds the request bodies and drops an empty note", () => {
    const draft = { ...EMPTY_RESTRICTION_DRAFT, reason: "fraud" as const, note: "  ", scheduleErasure: true };
    expect(toRestrictionInput("close", draft)).toEqual({ reason: "fraud", scheduleErasure: true });
    expect(toRestrictionInput("suspend", { ...draft, until: "2999-01-01", note: "n" })).toEqual({
      reason: "fraud",
      until: "2999-01-01T23:59:59.000Z",
      note: "n",
    });
    expect(toRestrictionInput("unsuspend", EMPTY_RESTRICTION_DRAFT)).toEqual({});
  });

  it("validates the end date and note length", () => {
    expect(validateRestrictionDraft("suspend", { ...EMPTY_RESTRICTION_DRAFT, until: "2000-01-01" }).until).toMatch(/future/);
    expect(validateRestrictionDraft("suspend", { ...EMPTY_RESTRICTION_DRAFT, until: "2999-01-01" })).toEqual({});
    expect(validateRestrictionDraft("close", { ...EMPTY_RESTRICTION_DRAFT, note: "x".repeat(1001) }).note).toMatch(/1000/);
  });

  it("words a confirmation for each action, danger for closure", () => {
    const erase = { ...EMPTY_RESTRICTION_DRAFT, scheduleErasure: true };
    expect(getRestrictionConfirmCopy("suspend", account, EMPTY_RESTRICTION_DRAFT).message).toMatch(/refunds/);
    expect(getRestrictionConfirmCopy("unsuspend", account, EMPTY_RESTRICTION_DRAFT).confirmLabel).toBe("Lift suspension");
    const close = getRestrictionConfirmCopy("close", account, erase);
    expect(close.variant).toBe("danger");
    expect(close.message).toMatch(/erasure/);
  });
});
