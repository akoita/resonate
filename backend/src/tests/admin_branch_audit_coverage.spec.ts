/**
 * Admin and operator branches inside routes that people use for their own data
 * are recorded in the admin audit log, or listed here with the reason they are
 * not (#2380, follow-up to #2362).
 *
 * `admin_audit_coverage.spec.ts` guards the routes restricted by `@Roles(...)`.
 * This guards the other half: a user-facing route that lets an admin or operator
 * in through a role check (reading any wallet, support access to a collection,
 * managing an artist's campaign). The check is a source scan: every comparison of
 * a role (or the literal ids "admin"/"operator") with admin or operator, per
 * file, must match the table below. A new branch changes a count and fails here,
 * which forces the decision: record it with `auditAdminBranch(...)` and list its
 * action, or write down why it is not recorded. A stale entry fails too.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { ADMIN_AUDIT_ACTIONS } from "../modules/admin_audit/admin_audit_event";

const SRC = join(__dirname, "..");
const MODULES = join(SRC, "modules");
const WEB_LIB = join(SRC, "..", "..", "web", "src", "lib");

/** A comparison of a role, or of the literal ids "admin"/"operator", with admin or operator. */
const ROLE_BRANCH = new RegExp(
  [
    String.raw`[A-Za-z]*[rR]ole\s*[!=]==\s*"(?:admin|operator)"`,
    String.raw`\["admin",\s*"operator"\]\.includes\(`,
    String.raw`new Set\(\["admin",\s*"operator"\]\)`,
    String.raw`userId\s*[!=]==\s*"(?:admin|operator)"`,
  ].join("|"),
  "g",
);

type Entry =
  | {
      /** Role comparisons in the file. */
      count: number;
      /** The branch is recorded: the file calls `auditAdminBranch` for each of these actions. */
      actions: string[];
      /** What in the file is deliberately not recorded, when the file also has comparisons that are not branches into someone else's data. */
      rest?: string;
    }
  | { count: number; actions?: undefined; reason: string };

const FILES: Record<string, Entry> = {
  // The helper itself.
  "admin_audit/admin_branch_audit.ts": {
    count: 2,
    reason: "The helper that records the branches; its role check is what decides whether to write.",
  },
  // Recorded branches inside user-facing routes.
  "identity/wallet.service.ts": { count: 1, actions: ["wallet.support_viewed"] },
  "identity/wallet.controller.ts": { count: 1, actions: ["wallet.support_changed"] },
  "contracts/metadata.controller.ts": {
    count: 4,
    actions: [
      "collection.support_viewed",
      "notifications.support_viewed",
      "seller_listings.support_viewed",
      "listing_intent.support_recorded",
      "rights_evidence.privileged_submitted",
    ],
    rest:
      "The collection read narrows its delivery state for any admin or operator (a display rule, not access); the access itself is recorded.",
  },
  "contracts/contracts.service.ts": { count: 2, actions: ["release_rights_request.support_viewed"] },
  "rights/rights-route-reassessment.service.ts": { count: 2, actions: ["rights_reassessment_history.support_viewed"] },
  "analytics/analytics_authorization.service.ts": {
    count: 3,
    actions: ["artist_analytics.support_viewed"],
    rest:
      "The AI DJ quality dashboard is aggregate counts with no person's data, and the `agent` role is the automated analytics reader, not a person.",
  },
  "shows/shows.service.ts": {
    count: 1,
    actions: ["show_campaign.operator_accessed", "show_pledge.operator_acted"],
    rest:
      "The operator console's management read (`GET /shows/campaigns/:id/manage`) loads on every campaign page an operator opens and is not recorded; each action taken from it is recorded on its own route.",
  },
  "community/community_eligibility.service.ts": { count: 2, actions: ["community_benefit_rule.operator_managed"] },
  "community/community_rooms.service.ts": {
    count: 8,
    actions: ["community_campaign_update.operator_posted"],
    rest:
      "The comparisons with the literal user ids \"admin\" and \"operator\" cannot be reached by a signed-in role (sessions carry wallet-address ids), and the viewer capability flag grants no access.",
  },
  // Not recorded, with the reason.
  "community/community_discord_bridge.service.ts": {
    count: 2,
    reason: "Compares the literal user ids \"admin\" and \"operator\", which a signed-in role session never carries (ids are wallet addresses); no role reaches it.",
  },
  "catalog/catalog.service.ts": {
    count: 2,
    reason: "Role check inside the credit identity review, an admin-only route recorded by @AdminAudit (catalog_credit.identity_reviewed).",
  },
  "artist/artist.service.ts": {
    count: 2,
    reason: "Role check inside the artist claim review, admin-only routes recorded by @AdminAudit (artist_claim.reviewed).",
  },
  "management/management.service.ts": {
    count: 2,
    reason: "Role check inside the transfer recovery review, an admin-only route recorded by @AdminAudit (management_recovery.reviewed).",
  },
  "dmca/dmca.service.ts": {
    count: 1,
    reason: "Reviewer set for the takedown queue and resolution, admin-only routes recorded by @AdminAudit (dmca.*).",
  },
  "shows/show-refund-reminder.service.ts": {
    count: 1,
    reason: "Operator-only unclaimed refund read, an aggregate by campaign with no person's data (listed in admin_audit_coverage.spec.ts).",
  },
  "rights/trusted-source.service.ts": {
    count: 1,
    reason: "Reached with role \"admin\" only by the service's own calls after an admin review, which is recorded by @AdminAudit (trusted_source_link.*); no user-facing route passes a role.",
  },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".spec.ts") ? [full] : [];
  });
}

function scan(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of sourceFiles(MODULES)) {
    const matches = readFileSync(file, "utf8").match(ROLE_BRANCH);
    if (matches) out[relative(MODULES, file)] = matches.length;
  }
  return out;
}

/** Actions the branch audit writes, with the file allowed to write them. */
const BRANCH_ACTIONS = new Map<string, string>();
for (const [file, entry] of Object.entries(FILES)) {
  for (const action of entry.actions ?? []) BRANCH_ACTIONS.set(action, file);
}

describe("admin branches inside user-facing routes are audited (#2380)", () => {
  const found = scan();

  it("lists every file that compares a role with admin or operator, with the same count", () => {
    expect(found).toEqual(Object.fromEntries(Object.entries(FILES).map(([file, entry]) => [file, entry.count])));
  });

  it("records every audited branch with auditAdminBranch and its action", () => {
    for (const [file, entry] of Object.entries(FILES)) {
      if (!entry.actions) continue;
      const source = readFileSync(join(MODULES, file), "utf8");
      expect(`${file} ${/auditAdminBranch\(/.test(source)}`).toBe(`${file} true`);
      for (const action of entry.actions) {
        expect(`${file} ${source.includes(`"${action}"`)}`).toBe(`${file} true`);
      }
    }
  });

  it("only the listed files write these actions, and every action is registered", () => {
    const registered = new Set<string>(ADMIN_AUDIT_ACTIONS);
    for (const action of BRANCH_ACTIONS.keys()) expect(registered.has(action)).toBe(true);
    for (const file of sourceFiles(MODULES)) {
      const rel = relative(MODULES, file);
      if (rel === "admin_audit/admin_audit_event.ts") continue;
      const source = readFileSync(file, "utf8");
      for (const [action, owner] of BRANCH_ACTIONS) {
        if (source.includes(`"${action}"`)) expect(`${action} in ${rel}`).toBe(`${action} in ${owner}`);
      }
    }
  });

  it("gives every unrecorded file and every unrecorded remainder a reason", () => {
    for (const entry of Object.values(FILES)) {
      const reason = entry.actions ? entry.rest : entry.reason;
      if (!entry.actions || entry.rest !== undefined) expect((reason ?? "").length).toBeGreaterThan(40);
    }
  });

  it("every audit action has a label on the admin audit page", () => {
    const labels = readFileSync(join(WEB_LIB, "adminAudit.ts"), "utf8");
    const types = readFileSync(join(WEB_LIB, "api.ts"), "utf8");
    const missing = ADMIN_AUDIT_ACTIONS.filter(
      (action) => !labels.includes(`value: "${action}"`) || !types.includes(`| "${action}"`),
    );
    expect(missing).toEqual([]);
  });
});
