import "dotenv/config";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { assertAnalyticsActorIdSaltConfiguration } from "../modules/analytics/analytics_identity";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { writeStructuredLog } from "../modules/shared/structured_logging";
import { prisma } from "../db/prisma";

/**
 * #1797 — the scheduled entry point for account erasures whose 30-day window
 * has elapsed.
 *
 * ## Why this is a script and not an HTTP call
 *
 * `POST /admin/erasure/run-due` exists and an operator can drive it by hand,
 * but nothing scheduled can: every route on `MaintenanceController` is guarded
 * by `AuthGuard("jwt")` + `RolesGuard` + `@Roles("admin")`, and Cloud Scheduler
 * can present a Google OIDC token but cannot mint an application JWT carrying
 * an allowlisted admin address. That is also why analytics retention (#1789)
 * was never scheduled — its endpoint was unreachable in exactly the same way.
 *
 * So this follows the one scheduled task that does work: a Cloud Run Job on the
 * backend image, with Cloud Scheduler invoking the job rather than the service.
 * No request crosses a boundary, so no application authentication is involved.
 *
 * ## Why it builds its own services instead of booting Nest
 *
 * All three collaborators are plain classes with no injected dependencies —
 * `PersonalDataResolverService` has no constructor, `AnalyticsGovernanceService`
 * takes an `@Optional()` target that defaults from the environment, and
 * `AccountClosureService` uses the Prisma singleton. Constructing them directly
 * keeps this job's environment down to a database URL and the analytics
 * settings.
 *
 * Booting `AppModule` instead would drag in the HTTP server, BullMQ and Redis,
 * and every secret the running service needs — which would mean duplicating the
 * service's whole environment block in Terraform and keeping two copies in step
 * by hand. It would also let an unrelated queue connection failure abort an
 * erasure run. A scheduled job should depend on as little as the work requires.
 *
 * ## Exit codes
 *
 * `0` only when every due erasure completed. A run that erased nobody because
 * nobody was due is also `0` — that is the normal state and must not page
 * anyone. Any failure exits `1`, so a failed run shows up as a failed execution
 * rather than a green job that quietly erased nothing.
 *
 * Usage: `node dist/scripts/run_due_erasures.js [--limit N]`
 */
export function parseLimit(argv: string[]): number | undefined {
  const index = argv.indexOf("--limit");
  if (index === -1) return undefined;
  const parsed = Number.parseInt(argv[index + 1] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * `0` only when nothing failed. Exported because the mapping is the whole
 * contract with the scheduler — a run that erased nobody because nobody was due
 * is a success, and a run that failed one erasure out of ten is not.
 */
export function exitCodeFor(result: { failed: number }): 0 | 1 {
  return result.failed > 0 ? 1 : 0;
}

export function buildErasureService(): PersonalDataErasureService {
  return new PersonalDataErasureService(
    new PersonalDataResolverService(),
    new AnalyticsGovernanceService(),
    new AccountClosureService(),
  );
}

export async function runDueErasuresScript(argv: string[] = process.argv.slice(2)) {
  assertAnalyticsActorIdSaltConfiguration();
  const limit = parseLimit(argv);

  try {
    const result = await buildErasureService().runDueErasures(limit ? { limit } : {});

    writeStructuredLog({
      level: result.failed > 0 ? "error" : "info",
      event: "privacy.account_erasure.scheduled_run",
      message:
        result.failed > 0
          ? `Scheduled erasure run finished with ${result.failed} failure(s)`
          : `Scheduled erasure run completed: ${result.erased} of ${result.due} due`,
      // Counts and request ids only. The whole point of the run is to remove
      // this person's identifiers; naming them here would put them back.
      due: result.due,
      erased: result.erased,
      failed: result.failed,
      ranAt: result.ranAt,
      failedRequestIds: result.results
        .filter((outcome) => outcome.status === "failed")
        .map((outcome) => outcome.requestId),
    });

    return result;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runDueErasuresScript()
    .then((result) => {
      process.exit(exitCodeFor(result));
    })
    .catch((error) => {
      // A crash before or during the run is not "nothing was due".
      writeStructuredLog({
        level: "error",
        event: "privacy.account_erasure.scheduled_run_crashed",
        message: "Scheduled erasure run could not complete",
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    });
}
