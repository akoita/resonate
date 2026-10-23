import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * #2317 guard. The analytics envelope caps `subjectId` at 200 characters, and
 * the domain-event bridge maps id fields (trackId, releaseId, jobId, ...) to it.
 * An emitter that builds one of those fields from a joined list (a batch of
 * picks) is rejected by the bridge and the event is silently lost, as happened
 * to the 12-track AI DJ session start. Emit one event per item instead.
 *
 * Source scan: no non-test backend source may assign a `...Id:` / `...Ids:`
 * property from an expression containing `.join(`.
 */
const SRC_ROOT = join(__dirname, "..");
const JOINED_ID_FIELD = /\b\w*Ids?\s*:[^,\n]*\.join\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "node_modules" || entry === "generated" ? [] : sourceFiles(full);
    }
    return full.endsWith(".ts") && !full.endsWith(".spec.ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

describe("analytics subject ids are never joined lists (#2317)", () => {
  it("finds no id field built with .join( in backend sources", () => {
    const offenders = sourceFiles(SRC_ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (JOINED_ID_FIELD.test(line) ? [`${file.slice(SRC_ROOT.length + 1)}:${index + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it("would flag the pre-fix session start emitter", () => {
    expect(JOINED_ID_FIELD.test('trackId: picks.map(p => p.trackId).join(","),')).toBe(true);
    expect(JOINED_ID_FIELD.test("trackIds: tracks.map((t) => t.id),")).toBe(false);
  });
});
