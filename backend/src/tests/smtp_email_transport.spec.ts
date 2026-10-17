import { PermanentEmailError, SmtpEmailTransport, TransientEmailError } from "../modules/email/email_transport";

const sendMail = jest.fn();
const createTransport = jest.fn();
jest.mock("nodemailer", () => ({
  createTransport: (...args: unknown[]) => {
    createTransport(...args);
    return { sendMail: (...mailArgs: unknown[]) => sendMail(...mailArgs) };
  },
}));

const MESSAGE = { to: "a@b.example", subject: "s", text: "t", html: "<p>t</p>", headers: { "List-Unsubscribe": "<x>" } };

describe("SmtpEmailTransport", () => {
  const transport = new SmtpEmailTransport("smtp://user:secret@smtp.example.test", "Resonate <n@example.test>");

  beforeEach(() => {
    sendMail.mockReset();
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
});
