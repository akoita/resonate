import { randomUUID } from "crypto";
import { createTransport, type Transporter } from "nodemailer";
import { writeStructuredLog } from "../shared/structured_logging";
import { parseMailbox, type EmailConfig } from "./email_config";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  messageId: string;
}

/**
 * Provider-neutral outgoing mail (#2169). Implementations throw
 * {@link PermanentEmailError} when the address itself is refused (so the
 * caller disables it) and any other error for a failure worth retrying.
 */
export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailSendResult>;
  /**
   * Check the connection and the login without sending anything. Throws a
   * {@link TransientEmailError} carrying the transport's error code. Optional:
   * transports with nothing to check (the dev log transport) omit it.
   */
  verify?(): Promise<void>;
}

/** Injection token for the active {@link EmailTransport}. */
export const EMAIL_TRANSPORT = Symbol("EMAIL_TRANSPORT");

/** The recipient was permanently refused (a 5xx recipient rejection): do not retry. */
export class PermanentEmailError extends Error {
  constructor(
    message: string,
    readonly code: string = "permanent",
  ) {
    super(message);
    this.name = "PermanentEmailError";
  }
}

/** A failure that may succeed later (network, 4xx, timeout). */
export class TransientEmailError extends Error {
  constructor(
    message: string,
    readonly code: string = "transient",
  ) {
    super(message);
    this.name = "TransientEmailError";
  }
}

/**
 * Whether a send failure is the recipient's address being refused. Only that is
 * the person's to fix; auth, connection, timeout and provider faults are ours.
 */
export function isRecipientRejection(error: unknown): boolean {
  return error instanceof PermanentEmailError;
}

/**
 * A log-safe code for a mail failure: the transport code when there is one,
 * else the error class name. Never the message, which can echo an address.
 */
export function emailErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  const raw = typeof code === "string" && code ? code : error instanceof Error ? error.name : "unknown";
  return raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
}

/**
 * Development and test transport: nothing leaves the process. It logs only
 * that a message was "sent" and the subject length — never the address, the
 * body or any link — and keeps the messages in memory so tests can read them.
 */
export class LogEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  /** Test hook: throw this instead of sending. */
  failWith: Error | null = null;
  private counter = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    this.counter += 1;
    writeStructuredLog({
      level: "info",
      event: "email.sent_dev",
      message: "Email accepted by the development log transport",
      subjectLength: message.subject.length,
    });
    return { messageId: `log-${Date.now()}-${this.counter}` };
  }
}

/** SMTP response codes that mean "this recipient will never work". */
function isPermanentRecipientRejection(error: unknown): boolean {
  const e = error as { responseCode?: unknown; code?: unknown };
  const code = typeof e?.responseCode === "number" ? e.responseCode : 0;
  if (code >= 500 && code < 600) {
    // 552 (mailbox full / message too large), 554 (transaction failed) and
    // 530/535 (auth) are not about the recipient's address.
    return code === 550 || code === 551 || code === 553 || code === 501;
  }
  return false;
}

/**
 * SMTP through nodemailer, configured only from `EMAIL_SMTP_URL`.
 *
 * Headers that mail filters weigh are set explicitly rather than left to
 * nodemailer's defaults: the `Message-ID` and the EHLO hostname both use the
 * domain of the configured sender (not the container's hostname), and an
 * optional `Reply-To` is added when configured.
 */
export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;
  /** Domain of the sender address, or `null` when it cannot be parsed. */
  private readonly senderDomain: string | null;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly replyTo: string = "",
  ) {
    this.senderDomain = parseMailbox(from)?.domain ?? null;
    this.transporter = this.senderDomain
      ? createTransport({ url: smtpUrl, name: this.senderDomain })
      : createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
        ...(this.senderDomain ? { messageId: `<${randomUUID()}@${this.senderDomain}>` } : {}),
        ...(this.replyTo ? { replyTo: this.replyTo } : {}),
      });
      return { messageId: String(info.messageId ?? "") };
    } catch (error) {
      const code = String((error as { code?: unknown })?.code ?? "smtp_error");
      if (isPermanentRecipientRejection(error)) {
        // The class and code reach the caller; the provider's text may echo the address.
        throw new PermanentEmailError("recipient rejected", `smtp_${(error as { responseCode: number }).responseCode}`);
      }
      throw new TransientEmailError("send failed", code);
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (error) {
      // As in `send`: only the code leaves, the provider's text may echo credentials.
      throw new TransientEmailError("verify failed", String((error as { code?: unknown })?.code ?? "smtp_error"));
    }
  }
}

/**
 * Check the SMTP login once at startup without delaying or failing boot, so a
 * refused login shows in the logs before the first person hits it. Never rejects.
 */
export function verifyEmailTransportInBackground(transport: EmailTransport | null): void {
  if (!transport?.verify) return;
  void transport.verify().then(
    () => {
      writeStructuredLog({ level: "info", event: "email.transport_verified", message: "SMTP login verified" });
    },
    (error: unknown) => {
      writeStructuredLog({
        level: "error",
        event: "email.transport_verify_failed",
        message: "SMTP connection or login failed; confirmation and notice emails will fail",
        errorClass: error instanceof Error ? error.name : "unknown",
        errorCode: emailErrorCode(error),
      });
    },
  );
}

/** The transport for this deployment, or `null` when email is disabled. */
export function createEmailTransport(config: EmailConfig): EmailTransport | null {
  if (config.transportKind === "log") return new LogEmailTransport();
  if (config.transportKind === "smtp") return new SmtpEmailTransport(config.smtpUrl, config.from, config.replyTo);
  return null;
}
