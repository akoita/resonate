import { buildErasureService, exitCodeFor, parseLimit } from "../scripts/run_due_erasures";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";

describe("scheduled erasure runner", () => {
  describe("exit code", () => {
    /**
     * The contract with the scheduler. Getting this backwards in either
     * direction is costly: a failed run reported green means erasures silently
     * stop happening (which is how #1789 went unnoticed for months), and an
     * idle run reported red pages somebody every night for nothing.
     */
    it("is a success when nothing was due", () => {
      expect(exitCodeFor({ failed: 0 })).toBe(0);
    });

    it("is a failure when any erasure failed, not only when all did", () => {
      expect(exitCodeFor({ failed: 1 })).toBe(1);
      expect(exitCodeFor({ failed: 9 })).toBe(1);
    });
  });

  describe("building the service without Nest", () => {
    /**
     * The job constructs its three collaborators directly so its Cloud Run
     * environment stays down to a database URL and the analytics settings —
     * booting `AppModule` would drag in the HTTP server, BullMQ and Redis, and
     * force the service's whole environment block to be duplicated in Terraform.
     *
     * That only holds while those three take no injected dependencies. If one
     * gains a constructor argument the compiler catches it here first, which is
     * the point: the alternative is finding out from a scheduled erasure that
     * crashed in production at 03:00.
     */
    it("constructs with no arguments and no container", () => {
      expect(buildErasureService()).toBeInstanceOf(PersonalDataErasureService);
    });
  });

  describe("--limit", () => {
    it("is absent unless given", () => {
      expect(parseLimit([])).toBeUndefined();
      expect(parseLimit(["--verbose"])).toBeUndefined();
    });

    it("reads a positive integer", () => {
      expect(parseLimit(["--limit", "25"])).toBe(25);
    });

    // An unparseable limit must not silently become a different number. It
    // becomes "no limit", which is the documented default, rather than 0 —
    // which would look like a working run that erased nobody.
    it("ignores a value that is not a positive integer", () => {
      expect(parseLimit(["--limit", "0"])).toBeUndefined();
      expect(parseLimit(["--limit", "-5"])).toBeUndefined();
      expect(parseLimit(["--limit", "all"])).toBeUndefined();
      expect(parseLimit(["--limit"])).toBeUndefined();
    });
  });
});
