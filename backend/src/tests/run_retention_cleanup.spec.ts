import { exitCodeFor, isDryRun } from "../scripts/run_retention_cleanup";

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
