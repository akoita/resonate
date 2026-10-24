/**
 * Request-body DTO guard (#2197, follow-up to #1888/#1890).
 *
 * The global ValidationPipe only checks bodies typed as a class. A body typed as
 * an interface, a type alias, an inline type, an intersection, `any` or
 * `unknown` compiles to `Object` and reaches the handler unvalidated. This
 * reflection test scans every controller and fails when a whole-body `@Body()`
 * parameter is not a class, unless the route is listed below with the reason
 * its body is checked elsewhere.
 *
 * Adding a route to a list is an exception that needs a justification a reviewer
 * can check. The default is a class DTO (see `backend/AGENTS.md` and
 * `docs/engineering/request-body-validation.md`). A stale entry (the route now
 * takes a class, or no longer exists) also fails, so the lists cannot rot.
 */

import "reflect-metadata";
import { execSync } from "child_process";
import * as path from "path";
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";

type Category = "service-validated" | "inline-auth" | "deferred-admin";

/** `Controller.handler` -> why this body is not a class DTO. */
const ALLOWED: Record<string, { category: Category; reason: string }> = {};

function sv(keys: string[], reason: string) {
  for (const key of keys) ALLOWED[key] = { category: "service-validated", reason };
}
function deferred(keys: string[], reason: string) {
  for (const key of keys) ALLOWED[key] = { category: "deferred-admin", reason };
}

// --- Authenticates (or gates) inside the handler: a DTO would answer 400 first. ---
const INLINE_AUTH: Record<string, string> = {
  "AuthController.login":
    "Dev-only route: the handler answers 403 when AUTH_DEV_LOGIN_ENABLED is off; it checks the body inline afterwards.",
  "FingerprintController.receiveFingerprint":
    "Internal worker route: the x-internal-service-key check runs in the handler before the body is read.",
  "IngestionController.handleProgress":
    "Internal worker route: the x-internal-service-key check runs first; progress and audioRevision are checked inline after it (#1890).",
  "AgentRuntimeWorkerController.execute":
    "Internal worker route: assertInternalRequest runs first, then normalizeAgentRuntimeExecutionRequest validates the whole body.",
};
for (const [key, reason] of Object.entries(INLINE_AUTH)) {
  ALLOWED[key] = { category: "inline-auth", reason };
}

// --- Admin routes owned by the step-up work (#2173): not touched here. ---
deferred(
  [
    "MaintenanceController.backfillStemAudioFeatures",
    "MaintenanceController.backfillTrackEmbeddings",
    "MaintenanceController.runDueAccountErasures",
    "MaintenanceController.loadAnalyticsWarehouse",
    "MaintenanceController.backfillAnalyticsWarehouse",
    "MaintenanceController.generateCommunityCohorts",
    "MaintenanceController.resolveCommunityModerationReport",
    "X402RefundReconciliationController.markRefunded",
    "NoticeController.broadcast",
    "NoticeController.targeted",
  ],
  "Admin controller: deferred until the admin step-up work (#2173) lands, to avoid conflicting edits. Convert in a follow-up.",
);

// --- Every field is checked by the service or the handler itself. ---
sv(
  [
    "AnalyticsController.ingest",
    "AnalyticsController.recordPlaybackCompleted",
    "AnalyticsController.recordPlaybackEvent",
    "AnalyticsController.recordProductEvent",
    "AnalyticsController.updateConsent",
  ],
  "Analytics normalizers (normalizeAnalyticsEventInput, normalize*Request, updateConsent) check every field and answer 400; several accept looser values on purpose.",
);
sv(
  [
    "ArtistController.updateSettings",
    "ArtistController.updateProfile",
    "ArtistController.getEnrichmentSuggestions",
    "ArtistController.submitClaim",
    "ArtistController.reviewClaim",
  ],
  "Typed `unknown`: ArtistService and the enrichment service validate each field and own the 400 messages.",
);
sv(
  ["CatalogController.reviewCreditIdentity", "CatalogController.updateTrackMetadata", "CatalogController.withdrawRelease"],
  "Typed `unknown` or optional: CatalogService (reviewCreditIdentity, updateTrackMetadata, normalizeWithdrawalReason) validates every field.",
);
sv(
  [
    "CommunityController.updateMyProfile",
    "CommunityController.createArtistBenefitRule",
    "CommunityController.connectArtistDiscordBridge",
    "CommunityController.upsertArtistDiscordRoleMapping",
    "CommunityController.createMessage",
    "CommunityController.reportMessage",
    "CommunityController.moderateMember",
    "CommunityController.updateRoomStatus",
  ],
  "Community services take `unknown` fields and normalize each one (normalizeProfileInput, normalizeManagedRuleInput, normalizeBody, ...).",
);
sv(
  ["AttestationVoucherController.createVoucher", "MintAuthorizationController.createAuthorization"],
  "The signing services parse every field (parseTokenId, parseBytes32, addresses, BigInt amounts that accept strings or numbers) before signing.",
);
sv(
  [
    "MetadataController.fileDispute",
    "MetadataController.createEvidenceBundle",
    "MetadataController.resolveDispute",
    "MetadataController.sampleRightsRouteAudits",
    "MetadataController.resetIndexer",
    "MetadataController.reindexTransaction",
    "MetadataController.notifyListingCreated",
  ],
  "Handler checks presence and values inline; chain ids, block numbers, amounts and limits are coerced by BigInt()/Math.max() and accept numeric strings, so a strict type check would reject accepted input.",
);
sv(
  ["DmcaController.fileReport", "DmcaController.fileCounter", "DmcaController.resolveReport"],
  "DmcaService checks every field (isNonEmptyString, outcome allow-list) and owns the 400 messages.",
);
sv(
  ["ManagementController.createGrant", "ManagementController.updateGrant", "ManagementController.createTransfer", "ManagementController.createTransferRecoveryRequest", "ManagementController.reviewTransferRecoveryRequest"],
  "ManagementService reads each field through read* helpers (recipient email, scopes, expiry, resources, recovery evidence); controllers reject non-objects.",
);
sv(
  ["AgentReputationFeedbackController.submit"],
  "The handler validates every field with validateEnum / explicit checks.",
);
sv(
  [
    "PunchlineController.updateDraft",
    "PunchlineController.addMoment",
    "PunchlineController.updateMoment",
    "PunchlineController.setDropUnlock",
    "PunchlineController.collectMoment",
  ],
  "PunchlineDropService/UnlockService/CollectService validate every field (normalizeOptionalText, validateMomentFields, Number.isInteger, normalizeWallet).",
);
sv(
  [
    "RecommendationsController.updateTasteMemorySettings",
    "RecommendationsController.upsertTasteSignalControl",
  ],
  "TasteMemoryService checks each field with typeof and normalize* helpers.",
);
sv(
  ["RemixController.generateDraft"],
  "validateRemixGenerationConstraints checks the constraints before any provider work; the project service validates retry, force and stemTransform against the live project.",
);
sv(
  [
    "SessionsController.createPlaybackCapability",
    "SessionsController.registerPlaybackDevice",
    "SessionsController.resolvePlaybackIntent",
    "SessionsController.queuePlaybackIntent",
    "SessionsController.playPlaybackIntent",
    "SessionsController.controlPlaybackIntent",
    "SessionsController.confirmPlaybackCommand",
  ],
  "Typed `unknown`: the controller sanitizes every field with typeof checks and sanitizePlayback* helpers.",
);
sv(
  [
    "ShowsController.createCampaignUpdate",
    "ShowsController.createSignal",
    "ShowsController.createCampaign",
    "ShowsController.updateCampaign",
    "ShowsController.reorderCampaignVisuals",
    "ShowsController.requestAuthority",
    "ShowsController.approveAuthority",
    "ShowsController.rejectAuthority",
    "ShowsController.revokeAuthority",
    "ShowsController.expireAuthority",
    "ShowsController.activateCampaign",
    "ShowsController.acknowledgeReconciliationMismatch",
    "ShowsController.removeReconciliationAcknowledgement",
    "ShowsController.createPledgeIntent",
    "ShowsController.confirmPledge",
    "ShowsController.confirmPledgeRefund",
    "ShowsController.cancelCampaign",
    "ShowsController.confirmBooking",
    "ShowsController.confirmFulfillment",
    "ShowsController.initiateDispute",
    "ShowsController.resolveDispute",
  ],
  "Typed `any`: ShowsService normalizes each field (normalizeCampaignBase, optionalText, optionalJsonObject, validate* helpers). Its input surface is large; a DTO per route is tracked as a follow-up.",
);
sv(
  ["IngestionController.enqueue"],
  "Deprecated route: IngestionService.enqueueUpload checks artistId and fileUris.",
);

function isClass(type: unknown): boolean {
  return (
    typeof type === "function" &&
    ![Object, Array, String, Number, Boolean, Function, Promise, Symbol, BigInt].includes(type as never)
  );
}

type Found = { key: string; file: string; typeName: string };

function scanControllers(): { found: Found[]; handlers: Set<string> } {
  const srcDir = path.join(__dirname, "..");
  const files = execSync("find modules -name '*.controller.ts'", { cwd: srcDir })
    .toString()
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .sort();
  const found: Found[] = [];
  const handlers = new Set<string>();
  for (const file of files) {
    const mod = require(path.join(srcDir, file));
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const controller = exported as new (...args: unknown[]) => unknown;
      if (Reflect.getMetadata(PATH_METADATA, controller) === undefined) continue;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") continue;
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
        if (typeof handler !== "function") continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        handlers.add(`${controller.name}.${name}`);
        const args: Record<string, { index: number; data?: unknown }> =
          Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
        const paramTypes: unknown[] = Reflect.getMetadata("design:paramtypes", controller.prototype, name) ?? [];
        for (const [argKey, arg] of Object.entries(args)) {
          if (Number(argKey.split(":")[0]) !== RouteParamtypes.BODY) continue;
          // `@Body("field")` hands over one value, not the body.
          if (arg.data !== undefined) continue;
          const type = paramTypes[arg.index];
          if (isClass(type)) continue;
          found.push({
            key: `${controller.name}.${name}`,
            file,
            typeName: typeof type === "function" ? type.name : String(type),
          });
        }
      }
    }
  }
  return { found, handlers };
}

describe("request bodies are class DTOs (#2197)", () => {
  const { found, handlers } = scanControllers();

  it("finds controllers and bodies", () => {
    expect(handlers.size).toBeGreaterThan(100);
    expect(found.length).toBeGreaterThan(0);
  });

  it("every whole-body @Body() parameter is a class, or listed with a justification", () => {
    const unlisted = found.filter((f) => !ALLOWED[f.key]).map((f) => `${f.file}: ${f.key} (${f.typeName})`);
    expect(unlisted).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const stillNonClass = new Set(found.map((f) => f.key));
    const stale = Object.keys(ALLOWED).filter((key) => !stillNonClass.has(key));
    expect(stale).toEqual([]);
  });

  it("gives every allowlist entry a reason", () => {
    for (const [key, entry] of Object.entries(ALLOWED)) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(key).toMatch(/^[A-Za-z0-9]+\.[A-Za-z0-9]+$/);
    }
  });
});
