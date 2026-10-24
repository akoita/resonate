/**
 * Every admin or operator route is either recorded in the admin audit log or
 * listed here with the reason it is not (#2362, follow-up to #2173).
 *
 * "Admin route" means a handler (or its controller) restricted by `@Roles(...)`
 * to a list that includes `admin` or `operator`. It is audited when it carries
 * `@AdminAudit(...)`, or when its service writes the record itself (listed under
 * SERVICE_AUDITED). Adding an admin route without either fails this test, which
 * is the point: the audit log is only worth reading if nothing skips it.
 * A stale entry also fails, so the lists cannot rot.
 */
import "reflect-metadata";
import { execSync } from "child_process";
import * as path from "path";
import { INTERCEPTORS_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { AdminAuditInterceptor } from "../modules/admin_audit/admin_audit.interceptor";
import { ROLES_KEY } from "../modules/auth/roles.decorator";

/** The service writes the `AdminAuditEvent` itself (it needs the outcome or a transaction). */
const SERVICE_AUDITED: Record<string, string> = {
  "AdminUsersController.detail": "AdminUsersService.detail writes user.detail_viewed before returning the record (#2166).",
  "AdminAccountsController.suspend": "AccountStatusService writes account.suspended (#2147).",
  "AdminAccountsController.unsuspend": "AccountStatusService writes account.unsuspended (#2147).",
  "AdminAccountsController.close": "AccountStatusService writes account.closed (#2147).",
  "AdminAgentSessionsController.events": "AdminAgentSessionsService writes agent_session.events_viewed (#2259).",
  "NoticeController.broadcast": "NoticeService writes notice.broadcast_sent (#2173).",
  "NoticeController.targeted": "NoticeService writes notice.targeted_sent (#2173).",
  "AdminStepUpController.verify": "AdminStepUpService writes admin.step_up_verified / admin.step_up_refused (#2173).",
};

/** Deliberately not recorded. Each reason is a decision a reviewer can challenge. */
const NOT_AUDITED: Record<string, string> = {
  "AdminAuditController.list": "Reading the audit log is not itself logged (#2173).",
  "AdminStepUpController.challenge": "A challenge changes nothing; the answer to it is recorded by verify.",
  "AdminUsersController.overview": "Aggregate counts only, no person's record (#2166 audits the detail view).",
  "AdminUsersController.list": "A directory page of masked rows; opening a record is what is audited (#2166).",
  "AdminAccountsController.status": "Restriction state shown on the record page, whose open is already audited as user.detail_viewed.",
  "NoticeController.listSent": "Sent broadcasts are public to their audience; nothing about a person.",
  "MaintenanceController.getStemAudioFeatureBackfillStatus": "A count of stems, no person's data.",
  "MaintenanceController.getAnalyticsPipelineHealth": "Pipeline health counters only.",
  "MaintenanceController.getCommunityCohortQuality": "Aggregate cohort quality, no member lists.",
  "ShowsController.listReconciliationMismatches": "Escrow drift facts by campaign, no person's data.",
  "ShowsController.listUnclaimedRefunds": "Refund amounts by campaign, no person's data.",
  "WalletController.getPaymasterStatus": "Paymaster configuration status.",
  "WalletController.validateSessionKey": "Checks a token the caller already holds; changes nothing.",
  "CurationController.stake": "Curator-role action (curators and admins), recorded by the curation audit service, not an operator action.",
  "CurationController.getStake": "Curator-role read of a curator's own stake.",
  "CurationController.report": "Curator-role action recorded by the curation audit service, not an operator action.",
};

type Found = { key: string; roles: string[] };

function adminRoutes(): { found: Found[]; audited: Set<string> } {
  const srcDir = path.join(__dirname, "..");
  const files = execSync("find modules -name '*.controller.ts'", { cwd: srcDir })
    .toString()
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .sort();
  const found: Found[] = [];
  const audited = new Set<string>();
  for (const file of files) {
    const mod = require(path.join(srcDir, file));
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const controller = exported as new (...args: unknown[]) => unknown;
      if (Reflect.getMetadata("path", controller) === undefined) continue;
      const classRoles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, controller);
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") continue;
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
        if (typeof handler !== "function") continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const roles: string[] = Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles ?? [];
        if (!roles.includes("admin") && !roles.includes("operator")) continue;
        const key = `${controller.name}.${name}`;
        const interceptors: unknown[] = Reflect.getMetadata(INTERCEPTORS_METADATA, handler) ?? [];
        if (interceptors.some((i) => i instanceof AdminAuditInterceptor)) audited.add(key);
        found.push({ key, roles });
      }
    }
  }
  return { found, audited };
}

describe("admin routes are audited (#2362)", () => {
  const { found, audited } = adminRoutes();

  it("finds the admin routes", () => {
    expect(found.length).toBeGreaterThan(60);
    expect(audited.size).toBeGreaterThan(50);
  });

  it("records every admin or operator route, or lists it with a reason", () => {
    const missing = found
      .map((f) => f.key)
      .filter((key) => !audited.has(key) && !SERVICE_AUDITED[key] && !NOT_AUDITED[key]);
    expect(missing).toEqual([]);
  });

  it("has no stale entries", () => {
    const keys = new Set(found.map((f) => f.key));
    const stale = [...Object.keys(SERVICE_AUDITED), ...Object.keys(NOT_AUDITED)].filter(
      (key) => !keys.has(key) || audited.has(key),
    );
    expect(stale).toEqual([]);
  });

  it("does not list a route both as service-audited and as not audited", () => {
    const both = Object.keys(SERVICE_AUDITED).filter((key) => NOT_AUDITED[key]);
    expect(both).toEqual([]);
  });

  it("gives every entry a reason", () => {
    for (const reason of [...Object.values(SERVICE_AUDITED), ...Object.values(NOT_AUDITED)]) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
