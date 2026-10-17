/**
 * SNS-compatible bounce route (#2177): the path token gate, envelope parsing,
 * the topic check, and the confirmation-URL guard. The delivery service is
 * mocked; the bounce and complaint behaviour behind it is covered by
 * `email_notices.integration.spec.ts` against real Postgres.
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { ContactEmailService } from "../modules/email/contact_email.service";
import { EmailConfig } from "../modules/email/email_config";
import { EmailDeliveryService } from "../modules/email/email_delivery.service";
import { EmailPublicController } from "../modules/email/email_public.controller";
import { EmailSnsService } from "../modules/email/email_sns.service";
import { createControllerTestApp } from "./e2e-helpers";

const TOKEN = "t".repeat(48);
const TOPIC = "arn:scw:sns:fr-par:project-test:email-events";
const CONFIRM_HOST = "sns.mnq.fr-par.example-provider.test";
const SNS_ENV = {
  NODE_ENV: "test",
  EMAIL_SNS_WEBHOOK_TOKEN: TOKEN,
  EMAIL_SNS_TOPIC_ARN: TOPIC,
  EMAIL_SNS_CONFIRM_HOST_SUFFIXES: "example-provider.test",
  EMAIL_SNS_EVENT_FORMAT: "scaleway-tem",
};

const mockDelivery = {
  handleProviderEvents: jest.fn(async (events: unknown[]) => ({ received: events.length, disabled: events.length, ignored: 0 })),
};

function confirmation(subscribeUrl: string, topicArn = TOPIC) {
  return JSON.stringify({
    Type: "SubscriptionConfirmation",
    MessageId: "m-1",
    Token: "subscription-token",
    TopicArn: topicArn,
    Message: "You have chosen to subscribe to the topic.",
    SubscribeURL: subscribeUrl,
    Timestamp: "2026-10-17T10:00:00Z",
    SignatureVersion: "1",
    Signature: "unverified",
    SigningCertURL: `https://${CONFIRM_HOST}/cert.pem`,
  });
}

function notification(message: unknown, topicArn = TOPIC) {
  return JSON.stringify({
    Type: "Notification",
    MessageId: "m-2",
    TopicArn: topicArn,
    Message: typeof message === "string" ? message : JSON.stringify(message),
    Timestamp: "2026-10-17T10:00:00Z",
  });
}

const goodConfirmUrl = `https://${CONFIRM_HOST}/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=abc`;

describe("Email SNS bounce route (http)", () => {
  let app: INestApplication;
  let offApp: INestApplication;
  const fetchFn = jest.fn();

  const build = async (env: NodeJS.ProcessEnv) => {
    const config = new EmailConfig(env);
    const service = new EmailSnsService(config, mockDelivery as unknown as EmailDeliveryService);
    service.fetchFn = fetchFn as unknown as typeof fetch;
    const built = await createControllerTestApp(
      EmailPublicController,
      [
        { provide: EmailConfig, useValue: config },
        { provide: EmailDeliveryService, useValue: mockDelivery },
        { provide: ContactEmailService, useValue: {} },
        { provide: EmailSnsService, useValue: service },
      ],
      { rawBody: true },
    );
    return { built };
  };

  beforeAll(async () => {
    // Structured logs go to console.info; their content is not asserted here.
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    ({ built: app } = await build(SNS_ENV));
    ({ built: offApp } = await build({ NODE_ENV: "test" }));
  });

  afterAll(async () => {
    await app.close();
    await offApp.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    mockDelivery.handleProviderEvents.mockClear();
    fetchFn.mockReset();
    fetchFn.mockResolvedValue({ status: 200 });
  });

  const post = (body: string, token = TOKEN, contentType = "text/plain; charset=UTF-8", target = app) =>
    request(target.getHttpServer()).post(`/email/webhook/sns/${token}`).set("Content-Type", contentType).send(body);

  it("answers 404 for a wrong token, and when the route is not configured", async () => {
    const body = notification({ type: "email_dropped", email_to: "gone@example.test" });
    await post(body, "x".repeat(48)).expect(404);
    await post(body, TOKEN.slice(1)).expect(404);
    await post(body, TOKEN, undefined, offApp).expect(404);
    expect(mockDelivery.handleProviderEvents).not.toHaveBeenCalled();
  });

  it("answers 400 for a malformed body or an unsupported message", async () => {
    await post("not json").expect(400);
    await post(JSON.stringify({ Type: "Notification", Message: "{}" })).expect(400); // no TopicArn
    await post(JSON.stringify({ Type: "Surprise", TopicArn: TOPIC })).expect(400);
    await post(notification("not json")).expect(400);
    await post(notification({ email_to: "no-type@example.test" })).expect(400);
    expect(mockDelivery.handleProviderEvents).not.toHaveBeenCalled();
  });

  it("answers 403 for another topic", async () => {
    await post(notification({ type: "email_dropped", email_to: "gone@example.test" }, "arn:scw:sns:fr-par:other:topic")).expect(403);
    expect(mockDelivery.handleProviderEvents).not.toHaveBeenCalled();
  });

  it("maps a notification sent as text/plain without an Origin header", async () => {
    const res = await post(notification({ type: "email_dropped", email_to: "gone@example.test" })).expect(200);
    expect(res.body).toEqual({ received: 1, disabled: 1, ignored: 0 });
    expect(mockDelivery.handleProviderEvents).toHaveBeenCalledWith([
      { type: "bounce", email: "gone@example.test", bounceType: "hard" },
    ]);
  });

  it("accepts the same envelope sent as application/json", async () => {
    await post(notification({ type: "email_spam", email_to: "spam@example.test" }), TOKEN, "application/json").expect(200);
    expect(mockDelivery.handleProviderEvents).toHaveBeenCalledWith([{ type: "complaint", email: "spam@example.test" }]);
  });

  it("counts delivered, queued and deferred events as ignored", async () => {
    const res = await post(notification({ type: "email_deferred", email_to: "slow@example.test" })).expect(200);
    expect(res.body).toEqual({ received: 1, disabled: 0, ignored: 1 });
    expect(mockDelivery.handleProviderEvents).toHaveBeenCalledWith([]);
  });

  it("confirms a subscription through an allowlisted host, without following redirects", async () => {
    const res = await post(confirmation(goodConfirmUrl)).expect(200);
    expect(res.body).toEqual({ status: "confirmed" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(goodConfirmUrl);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(init.signal).toBeDefined();
  });

  it("refuses a confirmation URL outside the allowlist and never fetches it", async () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://evil.test/?Action=ConfirmSubscription",
      `https://${CONFIRM_HOST}.evil.test/`,
      "https://notexample-provider.test/",
      `http://${CONFIRM_HOST}/`,
      `https://user:pass@${CONFIRM_HOST}/`,
      `https://${CONFIRM_HOST}:8443/`,
      `https://${CONFIRM_HOST}/?TopicArn=${encodeURIComponent("arn:scw:sns:fr-par:other:topic")}`,
    ]) {
      await post(confirmation(url)).expect(400);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("answers 502 when the confirmation URL does not answer 2xx or cannot be reached", async () => {
    fetchFn.mockResolvedValueOnce({ status: 302 });
    await post(confirmation(goodConfirmUrl)).expect(502);
    fetchFn.mockRejectedValueOnce(new Error("timeout"));
    await post(confirmation(goodConfirmUrl)).expect(502);
  });

  it("acknowledges an unsubscribe confirmation without acting on it", async () => {
    const res = await post(JSON.stringify({ Type: "UnsubscribeConfirmation", TopicArn: TOPIC })).expect(200);
    expect(res.body).toEqual({ status: "ignored" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
