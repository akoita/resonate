/**
 * The suspension allowlist (#2147) is a decorator on handlers, so this spec
 * pins the exact set of routes that carry it. Adding a route here is a decision
 * that a suspended account may call it: it must protect the person's money or
 * their rights over their own data (sign-in, refunds, export/erasure, notices),
 * or be listening (#2167: playback and DJ-session routes, whose plays are not
 * counted). Purchases, uploads, listings, pledges and posting never belong here.
 */
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA } from "@nestjs/common/constants";
import { readFileSync } from "fs";
import { join } from "path";
import { ALLOW_WHILE_SUSPENDED_KEY } from "../modules/accounts/allow_while_suspended.decorator";
import { AdminAccountsController } from "../modules/accounts/accounts.controller";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { AnalyticsController } from "../modules/analytics/analytics.controller";
import { AuthController } from "../modules/auth/auth.controller";
import { MetadataController } from "../modules/contracts/metadata.controller";
import { NoticeController } from "../modules/notifications/notice.controller";
import { PrivacyController } from "../modules/privacy/privacy.controller";
import { SessionsController } from "../modules/sessions/sessions.controller";
import { ShowsController } from "../modules/shows/shows.controller";

type Ctor = { prototype: Record<string, unknown>; name: string };

const CONTROLLERS = [
  AuthController,
  PrivacyController,
  NoticeController,
  ShowsController,
  MetadataController,
  AdminAccountsController,
  SessionsController,
  AnalyticsController,
  AgentConfigController,
] as unknown as Ctor[];

const MUTATING = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

/** `Controller.method` for every mutating handler that is allowed while suspended. */
function allowedMutatingHandlers(): string[] {
  const out: string[] = [];
  for (const controller of CONTROLLERS) {
    const classAllowed = Reflect.getMetadata(ALLOW_WHILE_SUSPENDED_KEY, controller) === true;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name];
      if (typeof handler !== "function") continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined || !MUTATING.has(method)) continue;
      if (classAllowed || Reflect.getMetadata(ALLOW_WHILE_SUSPENDED_KEY, handler) === true) {
        out.push(`${controller.name}.${name}`);
      }
    }
  }
  return out.sort();
}

describe("@AllowWhileSuspended allowlist", () => {
  it("is exactly the sign-in, refund, privacy, notice-read and listening routes", () => {
    expect(allowedMutatingHandlers()).toEqual(
      [
        // Sign-in and token issuance.
        "AuthController.login",
        "AuthController.nonce",
        "AuthController.verify",
        // Shows refund claim confirmation: a backer's money.
        "ShowsController.confirmPledgeRefund",
        // Data export and account erasure request/cancel.
        "PrivacyController.requestAccountClosureChallenge",
        "PrivacyController.requestAccountClosure",
        "PrivacyController.cancelAccountClosure",
        // Notices and notifications: reading what the platform told them.
        "NoticeController.markRead",
        "MetadataController.markNotificationRead",
        "MetadataController.markAllNotificationsRead",
        // Listening (#2167): player telemetry, DJ session start/stop/next and the
        // playback-intent routes. Plays from a restricted account are not counted.
        "AnalyticsController.recordPlaybackCompleted",
        "AnalyticsController.recordPlaybackEvent",
        "AgentConfigController.startSession",
        "AgentConfigController.stopSession",
        "SessionsController.start",
        "SessionsController.stop",
        "SessionsController.agentNext",
        "SessionsController.registerPlaybackDevice",
        "SessionsController.resolvePlaybackIntent",
        "SessionsController.queuePlaybackIntent",
        "SessionsController.playPlaybackIntent",
        "SessionsController.controlPlaybackIntent",
        "SessionsController.confirmPlaybackCommand",
      ].sort(),
    );
  });

  it("never allows a route that spends money or makes a purchase", () => {
    const allowed = allowedMutatingHandlers();
    // Priced session play (an agent purchase), generic product/ingest events and agent signals stay blocked.
    for (const blocked of [
      "SessionsController.play",
      "SessionsController.createPlaybackCapability",
      "AnalyticsController.ingest",
      "AnalyticsController.recordProductEvent",
      "AgentConfigController.recordSignal",
    ]) {
      expect(allowed).not.toContain(blocked);
    }
  });

  it("covers every privacy route, including the data export", () => {
    expect(Reflect.getMetadata(ALLOW_WHILE_SUSPENDED_KEY, PrivacyController)).toBe(true);
  });

  it("never allows the admin account-restriction routes", () => {
    expect(Reflect.getMetadata(ALLOW_WHILE_SUSPENDED_KEY, AdminAccountsController)).toBeUndefined();
    for (const name of ["suspend", "unsuspend", "close"]) {
      const handler = (AdminAccountsController.prototype as any)[name];
      expect(Reflect.getMetadata(ALLOW_WHILE_SUSPENDED_KEY, handler)).toBeUndefined();
    }
  });

  it("is enforced by the global interceptor registered in AppModule", () => {
    const source = readFileSync(join(__dirname, "../modules/app.module.ts"), "utf8");
    expect(source).toMatch(/APP_INTERCEPTOR,\s*useClass:\s*AccountStatusInterceptor/);
  });
});
