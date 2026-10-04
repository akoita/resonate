import { ConsoleLogger, LoggerService } from "@nestjs/common";
import {
  StructuredLogLevel,
  redactForLog,
  writeStructuredLog,
} from "./structured_logging";

type LineWriter = (line: string) => void;

const APP_LOG_EVENT = "app.log";
const MAX_MESSAGE_LENGTH = 2000;

function looksLikeStack(value: unknown): value is string {
  return typeof value === "string" && value.includes("\n") && value.includes("at ");
}

/**
 * Nest framework logger that writes one JSON object per line so Cloud Logging
 * assigns a severity and Error Reporting can group errors (#2076). It reuses the
 * `writeStructuredLog` envelope, so redaction and the `service` field match the
 * named observability events.
 */
export class StructuredNestLogger implements LoggerService {
  constructor(
    private readonly writer: LineWriter = (line) => process.stdout.write(`${line}\n`),
  ) {}

  log(message: unknown, ...optionalParams: unknown[]) {
    this.write("info", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.write("debug", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.write("debug", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.write("warn", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.write("error", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    this.write("error", message, optionalParams);
  }

  private write(level: StructuredLogLevel, message: unknown, params: unknown[]) {
    // Same convention as Nest's ConsoleLogger: the trailing string param is the
    // context, except an error stack passed without one.
    let rest = params.filter((param) => param !== undefined);
    let context: string | undefined;
    const last = rest[rest.length - 1];
    if (typeof last === "string" && !(level === "error" && looksLikeStack(last))) {
      context = last;
      rest = rest.slice(0, -1);
    }

    let error: Error | undefined;
    let stack: string | undefined;
    if (level === "error") {
      if (message instanceof Error) error = message;
      for (const param of rest) {
        if (param instanceof Error) error ??= param;
        else if (looksLikeStack(param)) stack ??= param;
      }
    }

    const { text, data } = describeMessage(message);
    writeStructuredLog(
      {
        level,
        event: APP_LOG_EVENT,
        message: text,
        ...(context ? { context } : {}),
        ...(data !== undefined ? { data } : {}),
        ...(error ? { error } : {}),
        ...(stack ? { stack } : {}),
      },
      this.writer,
    );
  }
}

function describeMessage(message: unknown): { text: string; data?: unknown } {
  if (typeof message === "string") return { text: message.slice(0, MAX_MESSAGE_LENGTH) };
  if (message instanceof Error) return { text: message.message.slice(0, MAX_MESSAGE_LENGTH) };
  if (message === null || message === undefined) return { text: String(message) };
  if (typeof message === "object") {
    // Objects go under a redacted `data` field; the message stays short.
    return { text: "object message", data: redactForLog(message) };
  }
  return { text: String(message) };
}

/**
 * `LOG_FORMAT=json|pretty`. Unset (or unknown) picks pretty on an interactive
 * terminal and JSON everywhere else, so deployed containers emit JSON.
 */
export function createAppLogger(
  env: NodeJS.ProcessEnv = process.env,
  isTty: boolean = Boolean(process.stdout.isTTY),
): LoggerService {
  const format = env.LOG_FORMAT?.trim().toLowerCase();
  if (format === "json") return new StructuredNestLogger();
  if (format === "pretty") return new ConsoleLogger();
  return isTty ? new ConsoleLogger() : new StructuredNestLogger();
}
