import { createTransport, type Transporter } from "nodemailer";
import { writeStructuredLog } from "../shared/structured_logging";
import type { EmailConfig } from "./email_config";

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

/** SMTP through nodemailer, configured only from `EMAIL_SMTP_URL`. */
export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = createTransport(smtpUrl);
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
}

/** The transport for this deployment, or `null` when email is disabled. */
export function createEmailTransport(config: EmailConfig): EmailTransport | null {
  if (config.transportKind === "log") return new LogEmailTransport();
  if (config.transportKind === "smtp") return new SmtpEmailTransport(config.smtpUrl, config.from);
  return null;
}
