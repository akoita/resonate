import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import EntitlementGrantsPanel, {
  EMPTY_GRANT_DRAFT,
  GRANT_NOTE_MAX,
  canRevoke,
  describeGrant,
  getGrantConfirmCopy,
  toGrantInput,
  validateGrantDraft,
  type GrantsState,
} from "./EntitlementGrantsPanel";
import type { EntitlementGrant } from "../../../../lib/api";

const NOW = new Date("2026-10-25T12:00:00.000Z");

const grant = (over: Partial<EntitlementGrant> = {}): EntitlementGrant => ({
  id: "grant-1",
  userId: "user-1",
  plan: "pro",
  source: "operator_grant",
  validFrom: "2026-10-25T00:00:00.000Z",
  validUntil: "2026-12-31T23:59:59.000Z",
  reason: "Founding artist",
  createdByUserId: "admin-1",
  createdAt: "2026-10-25T00:00:00.000Z",
  revokedAt: null,
  revokedByUserId: null,
  status: "active",
  ...over,
});

function render(state: GrantsState) {
  return renderToStaticMarkup(
    <EntitlementGrantsPanel
      state={state}
      draft={EMPTY_GRANT_DRAFT}
      errors={{}}
      busy={false}
      onChange={vi.fn()}
      onRequest={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
}

describe("EntitlementGrantsPanel (#2406)", () => {
  it("needs a future last day and a note", () => {
    expect(validateGrantDraft(EMPTY_GRANT_DRAFT, NOW)).toEqual({
      until: "Pick the last day of Pro.",
      note: "Say why, for the record (for example: founding artist).",
    });
    expect(validateGrantDraft({ ...EMPTY_GRANT_DRAFT, until: "2026-10-24", note: "x" }, NOW).until).toBe(
      "Pick a day in the future.",
    );
    expect(validateGrantDraft({ ...EMPTY_GRANT_DRAFT, until: "2026-12-31", note: "n".repeat(GRANT_NOTE_MAX + 1) }, NOW).note).toBe(
      `Keep the note to ${GRANT_NOTE_MAX} characters.`,
    );
    expect(validateGrantDraft({ ...EMPTY_GRANT_DRAFT, until: "2026-10-25", note: "founder" }, NOW)).toEqual({});
  });

  it("sends Pro until the end of the chosen day, with a trimmed note", () => {
    expect(toGrantInput("user-1", { until: "2026-12-31", source: "promo", note: "  launch promo " })).toEqual({
      userId: "user-1",
      source: "promo",
      validUntil: "2026-12-31T23:59:59.000Z",
      reason: "launch promo",
    });
  });

  it("only active or scheduled grants can be revoked", () => {
    expect(canRevoke(grant())).toBe(true);
    expect(canRevoke(grant({ status: "scheduled" }))).toBe(true);
    expect(canRevoke(grant({ status: "expired" }))).toBe(false);
    expect(canRevoke(grant({ status: "revoked", revokedAt: "2026-10-26T00:00:00.000Z" }))).toBe(false);
  });

  it("describes a grant and an open-ended one", () => {
    expect(describeGrant(grant())).toMatch(/^Active · Operator grant · from .+, until .+2026$/);
    expect(describeGrant(grant({ source: "promo", validUntil: null }))).toMatch(/Promotion · from .+, no end date$/);
    expect(describeGrant(grant({ status: "revoked", revokedAt: "2026-10-26T00:00:00.000Z" }))).toMatch(/^Revoked .* · revoked /);
  });

  it("confirms honestly: a grant changes the plan, not what they can do", () => {
    const copy = getGrantConfirmCopy({ kind: "grant" }, "Nova", { ...EMPTY_GRANT_DRAFT, until: "2026-12-31" });
    expect(copy.title).toBe("Grant Pro?");
    expect(copy.message).toContain("Pro tools are free for everyone today");
    expect(copy.message).toContain("never in the audit log");
    expect(getGrantConfirmCopy({ kind: "revoke", grant: grant() }, "Nova", EMPTY_GRANT_DRAFT).confirmLabel).toBe("Revoke grant");
  });

  it("lists grants with a Revoke button only where it does something", () => {
    const html = render({ status: "ready", grants: [grant(), grant({ id: "grant-2", status: "expired" })] });
    expect(html).toContain("Note: Founding artist");
    expect(html.match(/>Revoke</g)).toHaveLength(1);
    expect(html).toContain("Grant Pro");
    expect(html).toContain('type="date"');
  });

  it("says when there are no grants, and while loading", () => {
    expect(render({ status: "ready", grants: [] })).toContain("No Pro grants. Their plan is Free.");
    expect(render({ status: "loading" })).toContain("Loading Pro grants...");
    expect(render({ status: "error", message: "Boom" })).toContain("Try again");
  });
});
