/**
 * The set of routes behind a step-up proof (#2173) is a decision, so this spec
 * pins it. Adding `@RequireStepUp()` to a route (or removing it) must change
 * this list on purpose. It also checks the guard is registered globally, since
 * the decorator alone enforces nothing.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const MODULES = join(__dirname, "..", "modules");

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith(".controller.ts") ? [full] : [];
  });
}

/** `file:handler` for every handler carrying `@RequireStepUp()`. */
function protectedHandlers(): string[] {
  const out: string[] = [];
  for (const file of controllerFiles(MODULES)) {
    const source = readFileSync(file, "utf8");
    const pattern = /^ {2}@RequireStepUp\(\)\n[\s\S]*?\n {2}(?:async )?(\w+)\(/gm;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      out.push(`${file.slice(MODULES.length + 1)}:${match[1]}`);
    }
    if (/^@RequireStepUp\(\)/m.test(source)) out.push(`${file.slice(MODULES.length + 1)}:<whole controller>`);
  }
  return out.sort();
}

describe("@RequireStepUp routes", () => {
  it("are exactly the destructive admin actions (#2173, #2362, #2380)", () => {
    expect(protectedHandlers()).toEqual([
      // Account closure and suspension (#2147).
      "accounts/accounts.controller.ts:close",
      "accounts/accounts.controller.ts:suspend",
      // Indexer reset and manual reindex.
      "contracts/metadata.controller.ts:reindexTransaction",
      "contracts/metadata.controller.ts:resetIndexer",
      // Credit grants.
      "credits/credits.controller.ts:grant",
      "credits/credits.controller.ts:grantRequest",
      // Takedowns.
      "dmca/dmca.controller.ts:resolveReport",
      // Wallet recovery.
      "identity/wallet.controller.ts:approveRecovery",
      "identity/wallet.controller.ts:requestRecovery",
      "identity/wallet.controller.ts:setGuardians",
      // Maintenance deletes and resets; community moderation removals and bans.
      "maintenance/maintenance.controller.ts:cleanup",
      "maintenance/maintenance.controller.ts:resolveCommunityModerationReport",
      "maintenance/maintenance.controller.ts:runDueAccountErasures",
      "maintenance/maintenance.controller.ts:wipeReleases",
      // Management transfer recovery.
      "management/management.controller.ts:reviewTransferRecoveryRequest",
      // A broadcast cannot be recalled.
      "notifications/notice.controller.ts:broadcast",
      // Money release: the x402 refund record, Shows booking and fulfilment confirmation, dispute resolution (#2380).
      "punchline/x402-refund-reconciliation.controller.ts:markRefunded",
      "shows/shows.controller.ts:confirmBooking",
      "shows/shows.controller.ts:confirmFulfillment",
      "shows/shows.controller.ts:resolveDispute",
    ]);
  });

  it("every protected route is also role-restricted", () => {
    for (const entry of protectedHandlers()) {
      const [file, handler] = entry.split(":");
      const source = readFileSync(join(MODULES, file), "utf8");
      const definition = new RegExp(`^ +(?:async )?${handler}\\(`, "m").exec(source);
      expect(definition).not.toBeNull();
      const at = definition!.index;
      const decorators = source.slice(Math.max(0, source.lastIndexOf("\n\n", at)), at);
      expect(decorators).toContain("@Roles(");
    }
  });

  it("are enforced by a global guard registered after RolesGuard", () => {
    const appModule = readFileSync(join(MODULES, "app.module.ts"), "utf8");
    const roles = appModule.indexOf("useClass: RolesGuard");
    const stepUp = appModule.indexOf("useClass: AdminStepUpGuard");
    expect(roles).toBeGreaterThan(-1);
    expect(stepUp).toBeGreaterThan(roles);
  });
});
