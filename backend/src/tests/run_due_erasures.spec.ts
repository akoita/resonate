import { exitCodeFor, parseLimit } from "../scripts/run_due_erasures";

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
