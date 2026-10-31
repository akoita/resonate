import { exitCodeFor, isDryRun, scheduledRunLogFields } from "../scripts/run_retention_cleanup";

describe("scheduled retention runner", () => {
  describe("exit code", () => {
    /**
     * The contract with the scheduler, and the reason #1789 existed for as long
     * as it did: a governance job that reports success when it did not finish
     * is indistinguishable from one with nothing to do.
     */
    it("succeeds when the run completed", () => {
      expect(exitCodeFor({ status: "ok" })).toBe(0);
    });

    it("fails when Postgres was cleared but the warehouse was not", () => {
      // The two stores now disagree, and the next run cannot repair it —
      // retention derives its event ids from Postgres rows that are gone.
      expect(exitCodeFor({ status: "warehouse_failed" })).toBe(1);
    });

    it("treats any unrecognised status as a failure, not a success", () => {
      expect(exitCodeFor({ status: "something_new" })).toBe(1);
    });

    // #2430: a cancellation, pause or email push Stripe has not confirmed is
    // retried next run, but the run must not look clean while one is owed.
    it("fails when a billing lifecycle step did not complete", () => {
      expect(exitCodeFor({ status: "ok", billing: { failed: 0 } })).toBe(0);
      expect(exitCodeFor({ status: "ok", billing: { failed: 2 } })).toBe(1);
    });
  });

  describe("scheduled run log", () => {
    // The demand-observation purge is bounded per run, so its count is the only
    // way to see a backlog draining across scheduled runs.
    it("reports the demand-observation and pledge-context purges", () => {
      const fields = scheduledRunLogFields({
        status: "ok",
        deleted: 4,
        redacted: 2,
        lineageRecords: 6,
        demandObservationsDeleted: 1000,
        showPledgeDemandContextsDeleted: 3,
        policy: { sensitiveDays: 90, personalDays: 395, pseudonymousDays: 730 },
        warehouse: [],
        ranAt: "2026-10-14T04:00:00.000Z",
      });
      expect(fields).toMatchObject({
        status: "ok",
        deleted: 4,
        redacted: 2,
        demandObservationsDeleted: 1000,
        showPledgeDemandContextsDeleted: 3,
      });
    });
  });

  describe("--dry-run", () => {
    it("is off unless asked for", () => {
      expect(isDryRun([])).toBe(false);
      expect(isDryRun(["--limit", "5"])).toBe(false);
    });

    it("is on when asked for", () => {
      expect(isDryRun(["--dry-run"])).toBe(true);
    });
  });
});
