import { PermanentEmailError, SmtpEmailTransport, TransientEmailError } from "../modules/email/email_transport";

const sendMail = jest.fn();
jest.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: (...args: unknown[]) => sendMail(...args) }) }));

const MESSAGE = { to: "a@b.example", subject: "s", text: "t", html: "<p>t</p>", headers: { "List-Unsubscribe": "<x>" } };

describe("SmtpEmailTransport", () => {
  const transport = new SmtpEmailTransport("smtp://user:secret@smtp.example.test", "Resonate <n@example.test>");

  beforeEach(() => sendMail.mockReset());

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
