import * as structuredLogging from "../modules/shared/structured_logging";
import {
  LogEmailTransport,
  PermanentEmailError,
  SmtpEmailTransport,
  TransientEmailError,
  emailErrorCode,
  isRecipientRejection,
  verifyEmailTransportInBackground,
} from "../modules/email/email_transport";

const sendMail = jest.fn();
const verify = jest.fn();
const createTransport = jest.fn();
jest.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => {
    createTransport(...args);
    return { sendMail: (...mailArgs: unknown[]) => sendMail(...mailArgs), verify: () => verify() };
  },
}));

const MESSAGE = { to: "a@b.example", subject: "s", text: "t", html: "<p>t</p>", headers: { "List-Unsubscribe": "<x>" } };

describe("SmtpEmailTransport", () => {
  const transport = new SmtpEmailTransport("smtp://user:secret@smtp.example.test", "Resonate <n@example.test>");

  beforeEach(() => {
    sendMail.mockReset();
    verify.mockReset();
    createTransport.mockClear();
  });

  describe("headers and EHLO name", () => {
    const UUID_ID = /^<[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@example\.test>$/;

    it("sets an explicit Message-ID on the sender's domain, unique per message", async () => {
      sendMail.mockResolvedValue({ messageId: "x" });
      await transport.send(MESSAGE);
      await transport.send(MESSAGE);
      const ids = sendMail.mock.calls.map((call) => call[0].messageId);
      expect(ids[0]).toMatch(UUID_ID);
      expect(ids[1]).toMatch(UUID_ID);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it("derives the domain from a display-name sender and lower-cases it", async () => {
      const named = new SmtpEmailTransport("smtp://smtp.example.test", "Resonate Notices <Notices@Mail.Example.ORG>");
      sendMail.mockResolvedValue({ messageId: "x" });
      await named.send(MESSAGE);
      expect(sendMail.mock.calls[0][0].messageId).toMatch(/@mail\.example\.org>$/);
    });

    it("uses the sender's domain as the EHLO name instead of the container hostname", () => {
      new SmtpEmailTransport("smtp://smtp.example.test", "Resonate <n@example.test>");
      expect(createTransport).toHaveBeenCalledWith({ url: "smtp://smtp.example.test", name: "example.test" });
    });

    it("falls back to nodemailer's defaults when the sender cannot be parsed", async () => {
      const odd = new SmtpEmailTransport("smtp://smtp.example.test", "not-an-address");
      expect(createTransport).toHaveBeenCalledWith("smtp://smtp.example.test");
      sendMail.mockResolvedValue({ messageId: "x" });
      await odd.send(MESSAGE);
      expect(sendMail.mock.calls[0][0]).not.toHaveProperty("messageId");
    });

    it("adds Reply-To only when configured", async () => {
      sendMail.mockResolvedValue({ messageId: "x" });
      await transport.send(MESSAGE);
      expect(sendMail.mock.calls[0][0]).not.toHaveProperty("replyTo");
      const withReply = new SmtpEmailTransport("smtp://smtp.example.test", "Resonate <n@example.test>", "support@example.org");
      await withReply.send(MESSAGE);
      expect(sendMail.mock.calls[1][0].replyTo).toBe("support@example.org");
    });

    it("keeps the List-Unsubscribe headers it was given", async () => {
      sendMail.mockResolvedValue({ messageId: "x" });
      await transport.send(MESSAGE);
      expect(sendMail.mock.calls[0][0].headers).toEqual({ "List-Unsubscribe": "<x>" });
    });
  });

  it("sends through the configured sender and returns the message id", async () => {
    sendMail.mockResolvedValue({ messageId: "<abc@example.test>" });
    await expect(transport.send(MESSAGE)).resolves.toEqual({ messageId: "<abc@example.test>" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "Resonate <n@example.test>", to: "a@b.example", headers: MESSAGE.headers }));
  });

  it.each([550, 551, 553])("treats a %i recipient rejection as permanent, without echoing the provider text", async (responseCode) => {
    sendMail.mockRejectedValue(Object.assign(new Error("550 a@b.example does not exist"), { responseCode, code: "EENVELOPE" }));
    const error = await transport.send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(PermanentEmailError);
    expect(error.code).toBe(`smtp_${responseCode}`);
    expect(error.message).not.toContain("a@b.example");
  });

  it.each([
    ["a 4xx deferral", { responseCode: 451, code: "EENVELOPE" }],
    ["a mailbox-full 552", { responseCode: 552, code: "EENVELOPE" }],
    ["an auth failure", { responseCode: 535, code: "EAUTH" }],
    ["a network error", { code: "ECONNECTION" }],
  ])("treats %s as transient", async (_name, props) => {
    sendMail.mockRejectedValue(Object.assign(new Error("fail a@b.example"), props));
    const error = await transport.send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(TransientEmailError);
    expect(error.message).not.toContain("a@b.example");
  });

  it("keeps an auth failure on send transient with its code, so it is never blamed on the recipient", async () => {
    sendMail.mockRejectedValue(Object.assign(new Error("535 5.7.8 Invalid credentials for a@b.example"), { code: "EAUTH", responseCode: 535 }));
    const error = await transport.send(MESSAGE).catch((e) => e);
    expect(error).toBeInstanceOf(TransientEmailError);
    expect(error).not.toBeInstanceOf(PermanentEmailError);
    expect(error.code).toBe("EAUTH");
    expect(isRecipientRejection(error)).toBe(false);
  });

  describe("verify", () => {
    it("resolves when the connection and login check out", async () => {
      verify.mockResolvedValue(true);
      await expect(transport.verify()).resolves.toBeUndefined();
    });

    it("rejects with a transient error carrying only the transport code", async () => {
      verify.mockRejectedValue(Object.assign(new Error("Invalid login: 535 5.7.8 secret"), { code: "EAUTH", responseCode: 535 }));
      const error = await transport.verify().catch((e) => e);
      expect(error).toBeInstanceOf(TransientEmailError);
      expect(error.code).toBe("EAUTH");
      expect(error.message).not.toContain("secret");
    });

    it("falls back to a generic code when the failure has none", async () => {
      verify.mockRejectedValue(new Error("boom"));
      const error = await transport.verify().catch((e) => e);
      expect(error.code).toBe("smtp_error");
    });
  });
});

describe("emailErrorCode", () => {
  it("prefers a string code, else the error name, else unknown", () => {
    expect(emailErrorCode(Object.assign(new Error("x"), { code: "EAUTH" }))).toBe("EAUTH");
    expect(emailErrorCode(new TypeError("x"))).toBe("TypeError");
    expect(emailErrorCode("nope")).toBe("unknown");
    expect(emailErrorCode(null)).toBe("unknown");
  });

  it("strips anything outside a log-safe alphabet and caps the length", () => {
    expect(emailErrorCode({ code: "a@b.example smtp://x" })).toBe("a_b.example_smtp___x");
    expect(emailErrorCode({ code: "x".repeat(200) })).toHaveLength(64);
  });
});

describe("isRecipientRejection", () => {
  it("is true only for a permanent recipient refusal", () => {
    expect(isRecipientRejection(new PermanentEmailError("rejected", "smtp_550"))).toBe(true);
    expect(isRecipientRejection(new TransientEmailError("send failed", "EAUTH"))).toBe(false);
    expect(isRecipientRejection(new Error("timeout"))).toBe(false);
    expect(isRecipientRejection(undefined)).toBe(false);
  });
});

describe("verifyEmailTransportInBackground", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(structuredLogging, "writeStructuredLog").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("logs a verified login", async () => {
    verifyEmailTransportInBackground({ send: jest.fn(), verify: async () => undefined });
    await flush();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: "info", event: "email.transport_verified" }));
  });

  it("logs the transport code on failure and lets nothing escape", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const failing = new SmtpEmailTransport("smtp://user:secret@smtp.example.test", "Resonate <n@example.test>");
      verify.mockRejectedValue(Object.assign(new Error("535 Invalid credentials a@b.example"), { code: "EAUTH", responseCode: 535 }));
      expect(() => verifyEmailTransportInBackground(failing)).not.toThrow();
      await flush();
      await flush();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0][0];
    expect(entry).toEqual(
      expect.objectContaining({ level: "error", event: "email.transport_verify_failed", errorClass: "TransientEmailError", errorCode: "EAUTH" }),
    );
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain("a@b.example");
    expect(serialised).not.toContain("smtp://");
    expect(serialised).not.toContain("secret");
  });

  it("does nothing for a missing transport or one without verify", async () => {
    verifyEmailTransportInBackground(null);
    verifyEmailTransportInBackground(new LogEmailTransport());
    await flush();
    expect(log).not.toHaveBeenCalled();
  });
});
