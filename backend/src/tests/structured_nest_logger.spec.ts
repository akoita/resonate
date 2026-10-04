import { ConsoleLogger } from "@nestjs/common";
import {
  StructuredNestLogger,
  createAppLogger,
} from "../modules/shared/structured_nest_logger";

function build() {
  const lines: string[] = [];
  const logger = new StructuredNestLogger((line) => lines.push(line));
  return { logger, last: () => JSON.parse(lines[lines.length - 1]), lines };
}

const STACK = "Error: boom\n    at doIt (file.ts:1:1)\n    at run (file.ts:2:2)";

describe("StructuredNestLogger (#2076)", () => {
  it.each([
    ["log", "info", "INFO"],
    ["verbose", "debug", "DEBUG"],
    ["debug", "debug", "DEBUG"],
    ["warn", "warn", "WARNING"],
    ["error", "error", "ERROR"],
    ["fatal", "error", "ERROR"],
  ] as const)("%s maps to level %s and severity %s", (method, level, severity) => {
    const { logger, last } = build();
    logger[method]("hello", "SomeContext");
    expect(last()).toEqual(
      expect.objectContaining({
        service: "resonate-backend",
        event: "app.log",
        message: "hello",
        context: "SomeContext",
        level,
        severity,
      }),
    );
  });

  it("writes exactly one JSON object per line", () => {
    const { logger, lines } = build();
    logger.log("multi\nline message", "Ctx");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
  });

  it("omits context when none is given", () => {
    const { logger, last } = build();
    logger.log("hello");
    expect(last().context).toBeUndefined();
  });

  it("treats the trailing string as the context and ignores undefined params", () => {
    const { logger, last } = build();
    logger.warn("hello", undefined, "Ctx");
    expect(last().context).toBe("Ctx");
  });

  it("extracts a stack string plus context for errors", () => {
    const { logger, last } = build();
    logger.error("it failed", STACK, "MyService");
    const payload = last();
    expect(payload.context).toBe("MyService");
    expect(payload.message).toBe("it failed");
    expect(payload.stack_trace).toBe(STACK);
    expect(payload["@type"]).toContain("ReportedErrorEvent");
    expect(payload.serviceContext).toEqual({ service: "resonate-backend" });
  });

  it("treats a lone stack-like string as the stack, not the context", () => {
    const { logger, last } = build();
    logger.error("it failed", STACK);
    expect(last().stack_trace).toBe(STACK);
    expect(last().context).toBeUndefined();
  });

  it("uses an Error instance param for stack and errorClass", () => {
    const { logger, last } = build();
    const error = new RangeError("bad range");
    logger.error("it failed", error, "MyService");
    const payload = last();
    expect(payload.stack_trace).toBe(error.stack);
    expect(payload.errorClass).toBe("RangeError");
    expect(payload.context).toBe("MyService");
  });

  it("accepts an Error as the message", () => {
    const { logger, last } = build();
    logger.error(new TypeError("kaput"), "Ctx");
    expect(last().message).toBe("kaput");
    expect(last().errorClass).toBe("TypeError");
    expect(last().stack_trace).toContain("TypeError");
  });

  it("adds no stack fields to an error without one", () => {
    const { logger, last } = build();
    logger.error("plain failure", "Ctx");
    expect(last().stack_trace).toBeUndefined();
    expect(last().severity).toBe("ERROR");
  });

  it("does not add Error Reporting fields for warn", () => {
    const { logger, last } = build();
    logger.warn("careful", STACK, "Ctx");
    expect(last().stack_trace).toBeUndefined();
    expect(last()["@type"]).toBeUndefined();
  });

  it("stringifies primitives and puts objects under redacted data", () => {
    const { logger, last } = build();
    logger.log(42, "Ctx");
    expect(last().message).toBe("42");
    logger.log({ route: "/x", apiToken: "abc", nested: { password: "p", ok: 1 } }, "Ctx");
    const payload = last();
    expect(payload.message).toBe("object message");
    expect(payload.data).toEqual({
      route: "/x",
      apiToken: "[redacted]",
      nested: { password: "[redacted]", ok: 1 },
    });
    logger.log(undefined);
    expect(last().message).toBe("undefined");
  });
});

describe("createAppLogger", () => {
  it("LOG_FORMAT=json returns the structured logger", () => {
    expect(createAppLogger({ LOG_FORMAT: "json" }, true)).toBeInstanceOf(StructuredNestLogger);
  });

  it("LOG_FORMAT=pretty returns the console logger", () => {
    expect(createAppLogger({ LOG_FORMAT: "pretty" }, false)).toBeInstanceOf(ConsoleLogger);
  });

  it("is case-insensitive", () => {
    expect(createAppLogger({ LOG_FORMAT: "JSON" }, true)).toBeInstanceOf(StructuredNestLogger);
  });

  it("unset picks pretty on a TTY and json otherwise", () => {
    expect(createAppLogger({}, true)).toBeInstanceOf(ConsoleLogger);
    expect(createAppLogger({}, false)).toBeInstanceOf(StructuredNestLogger);
  });

  it("an unknown value falls back to the default", () => {
    expect(createAppLogger({ LOG_FORMAT: "xml" }, true)).toBeInstanceOf(ConsoleLogger);
    expect(createAppLogger({ LOG_FORMAT: "xml" }, false)).toBeInstanceOf(StructuredNestLogger);
  });
});
