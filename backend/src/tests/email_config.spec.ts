import { EmailConfig, SMTP_REQUIRED_ENV, parseMailbox } from "../modules/email/email_config";
import { LogEmailTransport, createEmailTransport } from "../modules/email/email_transport";
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  verifyWebhookSignature,
  newConfirmToken,
  sha256Hex,
} from "../modules/email/email_tokens";
import { renderNoticeEmail } from "../modules/email/email_templates";
import { createHmac } from "crypto";

const SMTP_ENV: NodeJS.ProcessEnv = {
  EMAIL_TRANSPORT: "smtp",
  EMAIL_FROM: "Resonate <notices@example.test>",
  EMAIL_SMTP_URL: "smtp://user:pass-value@smtp.example.test:587",
  EMAIL_LINK_SIGNING_SECRET: "signing-secret-value",
  FRONTEND_URL: "https://app.example.test/",
  PUBLIC_API_URL: "https://api.example.test",
};

describe("EmailConfig availability", () => {
  it("is disabled in production when EMAIL_TRANSPORT is unset", () => {
    const config = new EmailConfig({ NODE_ENV: "production" });
    expect(config.isAvailable()).toBe(false);
    expect(config.transportKind).toBeNull();
    expect(config.disabledReason).toBe("not_configured");
  });

  it.each([undefined, "development", "test"])("defaults to the log transport when NODE_ENV is %s", (nodeEnv) => {
    const config = new EmailConfig({ NODE_ENV: nodeEnv });
    expect(config.isAvailable()).toBe(true);
    expect(config.transportKind).toBe("log");
    expect(createEmailTransport(config)).toBeInstanceOf(LogEmailTransport);
    // A secret exists without being a source default: it is generated per process.
    expect(config.linkSigningSecret.length).toBeGreaterThanOrEqual(32);
  });

  it("refuses the log transport in production", () => {
    const config = new EmailConfig({ NODE_ENV: "production", EMAIL_TRANSPORT: "log" });
    expect(config.isAvailable()).toBe(false);
    expect(config.disabledReason).toBe("log_in_production");
  });

  it("disables an unknown transport", () => {
    const config = new EmailConfig({ EMAIL_TRANSPORT: "carrier-pigeon" });
    expect(config.isAvailable()).toBe(false);
    expect(config.disabledReason).toBe("invalid_transport");
  });

  it("is available with smtp when every variable is set", () => {
    const config = new EmailConfig({ NODE_ENV: "production", ...SMTP_ENV });
    expect(config.isAvailable()).toBe(true);
    expect(config.transportKind).toBe("smtp");
    expect(config.frontendUrl).toBe("https://app.example.test");
    expect(createEmailTransport(config)).not.toBeNull();
  });

  it.each(SMTP_REQUIRED_ENV)("is disabled with smtp when %s is missing, naming it", (name) => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...SMTP_ENV };
    delete env[name];
    const config = new EmailConfig(env);
    expect(config.isAvailable()).toBe(false);
    expect(config.disabledReason).toBe("missing_variables");
    expect(config.missing).toEqual([name]);
    expect(createEmailTransport(config)).toBeNull();
  });

  it("logs the missing variable names once and never a value", () => {
    const writes: string[] = [];
    const spies = (["info", "warn", "error", "log"] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        writes.push(args.map(String).join(" "));
      }),
    );
    try {
      const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...SMTP_ENV };
      delete env.EMAIL_SMTP_URL;
      delete env.PUBLIC_API_URL;
      new EmailConfig(env).logIfDisabled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const output = writes.join("");
    expect(output).toContain("EMAIL_SMTP_URL");
    expect(output).toContain("PUBLIC_API_URL");
    expect(output).not.toContain("signing-secret-value");
    expect(output).not.toContain("pass-value");
    expect(output).not.toContain("notices@example.test");
  });
});

describe("parseMailbox", () => {
  it.each([
    ["notices@example.org", "notices@example.org", "example.org"],
    ["Resonate <notices@Mail.Example.org>", "notices@Mail.Example.org", "mail.example.org"],
    ['"Resonate Notices" <notices@example.org>', "notices@example.org", "example.org"],
    ["  Name <a@b.example>  ", "a@b.example", "b.example"],
  ])("parses %s", (value, address, domain) => {
    expect(parseMailbox(value)).toEqual({ address, domain });
  });

  it.each([
    "",
    "   ",
    "no-at-sign",
    "a@localhost",
    "a@b",
    "Name <a@b>",
    "a b@example.org",
    "a@exa mple.org",
    "a@example.org\r\nBcc: x@example.org",
    "<a@example.org> trailing",
    "a@@example.org",
    "a@-example.org",
  ])("rejects %j", (value) => {
    expect(parseMailbox(value)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseMailbox(undefined)).toBeNull();
  });
});

describe("EmailConfig optional deliverability settings", () => {
  function captureWarnings<T>(fn: () => T): { result: T; output: string } {
    const writes: string[] = [];
    const spies = (["info", "warn", "error", "log"] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        writes.push(args.map(String).join(" "));
      }),
    );
    try {
      return { result: fn(), output: writes.join("") };
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  }

  it("leaves both empty when unset", () => {
    const { result: config, output } = captureWarnings(() => new EmailConfig({ NODE_ENV: "production", ...SMTP_ENV }));
    expect(config.replyTo).toBe("");
    expect(config.footerText).toBe("");
    expect(output).toBe("");
  });

  it("accepts a valid EMAIL_REPLY_TO, with or without a display name", () => {
    for (const value of ["support@example.org", "Support <support@example.org>"]) {
      const { result: config, output } = captureWarnings(() => new EmailConfig({ ...SMTP_ENV, EMAIL_REPLY_TO: value }));
      expect(config.replyTo).toBe(value);
      expect(output).toBe("");
    }
  });

  it("ignores an invalid EMAIL_REPLY_TO and warns naming the variable, never the value", () => {
    const { result: config, output } = captureWarnings(() => new EmailConfig({ ...SMTP_ENV, EMAIL_REPLY_TO: "not an address" }));
    expect(config.replyTo).toBe("");
    expect(config.isAvailable()).toBe(true);
    expect(output).toContain("EMAIL_REPLY_TO");
    expect(output).toContain('"level":"warn"');
    expect(output).not.toContain("not an address");
  });

  it("reads EMAIL_FOOTER_TEXT, keeping line breaks, dropping other control characters and capping its length", () => {
    expect(new EmailConfig({ ...SMTP_ENV, EMAIL_FOOTER_TEXT: "  Example Org\r\n1 Example Street\u0007  " }).footerText).toBe(
      "Example Org\n1 Example Street",
    );
    expect(new EmailConfig({ ...SMTP_ENV, EMAIL_FOOTER_TEXT: "x".repeat(2000) }).footerText).toHaveLength(500);
  });

  it("passes the reply-to to the SMTP transport factory without making email unavailable", () => {
    expect(createEmailTransport(new EmailConfig({ ...SMTP_ENV, EMAIL_REPLY_TO: "support@example.org" }))).not.toBeNull();
  });
});

describe("email tokens", () => {
  const secret = "unit-test-signing-secret";

  it("round-trips an unsubscribe token", () => {
    const token = signUnsubscribeToken("user-1", "policy", secret);
    expect(verifyUnsubscribeToken(token, secret)).toEqual({ userId: "user-1", category: "policy" });
  });

  it("rejects a tampered, re-signed, truncated or foreign token", () => {
    const token = signUnsubscribeToken("user-1", "policy", secret);
    const [payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "user-2", category: "policy", v: 1 })).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${mac}`, secret)).toBeNull();
    expect(verifyUnsubscribeToken(`${payload}.${mac.slice(0, -2)}AA`, secret)).toBeNull();
    expect(verifyUnsubscribeToken(token.slice(0, -4), secret)).toBeNull();
    expect(verifyUnsubscribeToken(token, "another-secret")).toBeNull();
    expect(verifyUnsubscribeToken(token, "")).toBeNull();
    expect(verifyUnsubscribeToken("not-a-token", secret)).toBeNull();
    expect(verifyUnsubscribeToken(undefined, secret)).toBeNull();
    expect(verifyUnsubscribeToken({ a: 1 }, secret)).toBeNull();
  });

  it("hashes confirmation tokens and never stores the raw value", () => {
    const { raw, hash } = newConfirmToken();
    expect(raw.length).toBeGreaterThanOrEqual(43);
    expect(hash).toBe(sha256Hex(raw));
    expect(hash).not.toContain(raw);
    expect(newConfirmToken().raw).not.toBe(raw);
  });

  it("verifies a webhook signature over the raw bytes", () => {
    const body = Buffer.from('{"events":[]}');
    const good = `sha256=${createHmac("sha256", "hook").update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, good, "hook")).toBe(true);
    expect(verifyWebhookSignature(body, good, "other")).toBe(false);
    expect(verifyWebhookSignature(Buffer.from('{"events": []}'), good, "hook")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=zz", "hook")).toBe(false);
    expect(verifyWebhookSignature(body, undefined, "hook")).toBe(false);
    expect(verifyWebhookSignature(body, good, "")).toBe(false);
  });
});

describe("renderNoticeEmail", () => {
  const settings = { frontendUrl: "https://app.example.test", publicApiUrl: "https://api.example.test", linkSigningSecret: "s" };
  const base = { userId: "u1", to: "a@b.example", title: "Hello\r\nBcc: x@y.example", body: "Body <b>text</b>", link: null };

  it("gives optional categories an unsubscribe link and one-click headers", () => {
    const mail = renderNoticeEmail({ ...base, category: "policy" }, settings);
    expect(mail.subject).toBe("[Resonate] Hello Bcc: x@y.example");
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/api\.example\.test\/email\/unsubscribe\/one-click\?token=/);
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.text).toContain("https://app.example.test/email/unsubscribe?token=");
    expect(mail.text).toContain("Open Resonate: https://app.example.test/");
    expect(mail.text).toContain("https://app.example.test/settings?section=email");
    expect(mail.html).not.toContain("<b>text</b>");
  });

  it("gives required categories neither a link nor a header, and uses the notice link", () => {
    for (const category of ["terms", "account"]) {
      const mail = renderNoticeEmail({ ...base, category, link: "/help/platform-notices" }, settings);
      expect(mail.headers).toEqual({});
      expect(mail.text).not.toContain("/email/unsubscribe");
      expect(mail.text).toContain("required");
      expect(mail.text).toContain("https://app.example.test/help/platform-notices");
    }
  });
});
