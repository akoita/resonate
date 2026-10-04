import { writeStructuredLog } from "../modules/shared/structured_logging";

function write(entry: Parameters<typeof writeStructuredLog>[0]) {
  const lines: string[] = [];
  writeStructuredLog(entry, (line) => lines.push(line));
  return JSON.parse(lines[0]);
}

const ERROR_REPORTING_TYPE =
  "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

describe("structured logging severity and Error Reporting fields (#2076)", () => {
  it.each([
    ["debug", "DEBUG"],
    ["info", "INFO"],
    ["warn", "WARNING"],
    ["error", "ERROR"],
  ] as const)("maps level %s to severity %s and keeps level", (level, severity) => {
    const payload = write({ level, event: "test.event", message: "m" });
    expect(payload.severity).toBe(severity);
    expect(payload.level).toBe(level);
    expect(payload.service).toBe("resonate-backend");
    expect(payload.event).toBe("test.event");
  });

  it("does not let an entry override the computed severity", () => {
    const payload = write({ level: "info", event: "e", message: "m", severity: "CRITICAL" });
    expect(payload.severity).toBe("INFO");
  });

  it("adds Error Reporting fields for an error-level Error", () => {
    const error = new TypeError("boom");
    const payload = write({ level: "error", event: "e", message: "failed", error });
    expect(payload.stack_trace).toBe(error.stack);
    expect(payload["@type"]).toBe(ERROR_REPORTING_TYPE);
    expect(payload.serviceContext).toEqual({ service: "resonate-backend" });
    expect(payload.errorClass).toBe("TypeError");
    expect(payload.error).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('"message":"boom"');
  });

  it("uses a string stack on an error-level entry", () => {
    const payload = write({
      level: "error",
      event: "e",
      message: "failed",
      stack: "Error: x\n    at foo (a.ts:1:1)",
    });
    expect(payload.stack_trace).toContain("at foo");
    expect(payload["@type"]).toBe(ERROR_REPORTING_TYPE);
    expect(payload.stack).toBeUndefined();
  });

  it("does not truncate stack_trace at 512 chars but bounds it at 8000", () => {
    const medium = write({
      level: "error",
      event: "e",
      message: "m",
      stack: `Error: x\n${"    at f (a.ts:1:1)\n".repeat(60)}`,
    });
    expect(medium.stack_trace.length).toBeGreaterThan(512);
    expect(medium.stack_trace).not.toContain("[truncated]");

    const huge = write({ level: "error", event: "e", message: "m", stack: "a".repeat(20000) });
    expect(huge.stack_trace).toHaveLength(8000);
  });

  it("adds no Error Reporting fields below error level, but keeps errorClass", () => {
    const payload = write({
      level: "warn",
      event: "e",
      message: "m",
      error: new RangeError("x"),
    });
    expect(payload.stack_trace).toBeUndefined();
    expect(payload["@type"]).toBeUndefined();
    expect(payload.serviceContext).toBeUndefined();
    expect(payload.errorClass).toBe("RangeError");
  });

  it("adds no Error Reporting fields for an error without a stack", () => {
    const payload = write({ level: "error", event: "e", message: "m" });
    expect(payload.stack_trace).toBeUndefined();
    expect(payload["@type"]).toBeUndefined();
  });

  it("keeps a plain string error field used by existing callers", () => {
    const payload = write({ level: "error", event: "e", message: "m", error: "db down" });
    expect(payload.error).toBe("db down");
    expect(payload.errorClass).toBeUndefined();
  });
});
