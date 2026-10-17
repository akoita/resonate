/**
 * Pure helpers of the SNS-compatible bounce adapter (#2177) and its settings.
 */
import { EmailConfig } from "../modules/email/email_config";
import { isAllowedSubscribeUrl, mapSnsMessage, parseSnsEnvelope, snsTokenMatches } from "../modules/email/email_sns";

const TOPIC = "arn:scw:sns:fr-par:project:email-events";

describe("parseSnsEnvelope", () => {
  it("reads the three message types", () => {
    expect(parseSnsEnvelope(JSON.stringify({ Type: "Notification", TopicArn: TOPIC, Message: "{}" }))).toEqual({
      type: "Notification",
      topicArn: TOPIC,
      message: "{}",
    });
    expect(
      parseSnsEnvelope(JSON.stringify({ Type: "SubscriptionConfirmation", TopicArn: TOPIC, SubscribeURL: "https://x.test/" })),
    ).toEqual({ type: "SubscriptionConfirmation", topicArn: TOPIC, subscribeUrl: "https://x.test/" });
    expect(parseSnsEnvelope(JSON.stringify({ Type: "UnsubscribeConfirmation", TopicArn: TOPIC }))).toEqual({
      type: "UnsubscribeConfirmation",
      topicArn: TOPIC,
    });
  });

  it("returns null for anything else", () => {
    for (const raw of [
      "",
      "null",
      "[]",
      "{",
      JSON.stringify({ Type: "Notification", Message: "{}" }),
      JSON.stringify({ Type: "Notification", TopicArn: TOPIC, Message: {} }),
      JSON.stringify({ Type: "SubscriptionConfirmation", TopicArn: TOPIC }),
      JSON.stringify({ Type: "Other", TopicArn: TOPIC }),
    ]) {
      expect(parseSnsEnvelope(raw)).toBeNull();
    }
  });
});

describe("snsTokenMatches", () => {
  it("matches only the exact token", () => {
    const token = "a".repeat(48);
    expect(snsTokenMatches(token, token)).toBe(true);
    expect(snsTokenMatches(`${token}a`, token)).toBe(false);
    expect(snsTokenMatches("", token)).toBe(false);
    expect(snsTokenMatches(undefined, token)).toBe(false);
    expect(snsTokenMatches(token, "")).toBe(false);
  });
});

describe("isAllowedSubscribeUrl", () => {
  const suffixes = ["provider.test", ".other.test"];
  const ok = (url: string) => isAllowedSubscribeUrl(url, suffixes, TOPIC);

  it("allows HTTPS on an allowlisted host or subdomain for the configured topic", () => {
    expect(ok("https://provider.test/")).toBe(true);
    expect(ok(`https://sns.mnq.fr-par.provider.test/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}`)).toBe(true);
    expect(ok("https://a.other.test/x")).toBe(true);
  });

  it("refuses other hosts, schemes, ports, credentials and topics", () => {
    expect(ok("https://evilprovider.test/")).toBe(false);
    expect(ok("https://provider.test.evil.test/")).toBe(false);
    expect(ok("http://provider.test/")).toBe(false);
    expect(ok("https://provider.test:444/")).toBe(false);
    expect(ok("https://u:p@provider.test/")).toBe(false);
    expect(ok("https://provider.test/?TopicArn=arn:other")).toBe(false);
    expect(ok("not a url")).toBe(false);
    expect(isAllowedSubscribeUrl("https://provider.test/", [], TOPIC)).toBe(false);
    // A bare top-level suffix would allow everything under it.
    expect(isAllowedSubscribeUrl("https://provider.test/", ["test"], TOPIC)).toBe(false);
  });
});

describe("mapSnsMessage (scaleway-tem)", () => {
  const map = (message: unknown) => mapSnsMessage("scaleway-tem", JSON.stringify(message));

  it("maps permanent rejections to hard bounces and spam to complaints", () => {
    expect(map({ type: "email_dropped", email_to: "a@x.test" })).toEqual({
      events: [{ type: "bounce", email: "a@x.test", bounceType: "hard" }],
      ignored: 0,
    });
    expect(map({ type: "email_mailbox_not_found", email_to: "b@x.test" })?.events).toEqual([
      { type: "bounce", email: "b@x.test", bounceType: "hard" },
    ]);
    expect(map({ type: "email_blocklisted", email_to: "c@x.test", blocklist_type: "mailbox_not_found" })?.events).toEqual([
      { type: "bounce", email: "c@x.test", bounceType: "hard" },
    ]);
    expect(map({ type: "email_spam", email_to: "d@x.test" })?.events).toEqual([{ type: "complaint", email: "d@x.test" }]);
  });

  it("ignores delivered, queued, deferred, full-mailbox and unknown events, and accepts an array", () => {
    expect(
      map([
        { type: "email_delivered", email_to: "a@x.test" },
        { type: "email_queued", email_to: "a@x.test" },
        { type: "email_deferred", email_to: "a@x.test" },
        { type: "blocklist_created", email_to: "a@x.test", blocklist_type: "mailbox_full" },
        { type: "unknown_type", email_to: "a@x.test" },
        { type: "email_dropped" },
      ]),
    ).toEqual({ events: [], ignored: 6 });
  });

  it("returns null for invalid JSON, a missing type or an unknown format", () => {
    expect(mapSnsMessage("scaleway-tem", "nope")).toBeNull();
    expect(map({ email_to: "a@x.test" })).toBeNull();
    expect(map([null])).toBeNull();
    expect(mapSnsMessage("other", JSON.stringify({ type: "email_dropped", email_to: "a@x.test" }))).toBeNull();
  });
});

describe("EmailConfig SNS settings", () => {
  beforeAll(() => {
    // Structured logs go to console.info; their content is not asserted here.
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  const full = {
    NODE_ENV: "test",
    EMAIL_SNS_WEBHOOK_TOKEN: "k".repeat(43),
    EMAIL_SNS_TOPIC_ARN: TOPIC,
    EMAIL_SNS_CONFIRM_HOST_SUFFIXES: " Provider.test , ,other.test",
    EMAIL_SNS_EVENT_FORMAT: "Scaleway-TEM",
  };

  it("enables the route with a token, a topic and a known format", () => {
    const config = new EmailConfig(full);
    expect(config.isSnsWebhookEnabled()).toBe(true);
    expect(config.snsConfirmHostSuffixes).toEqual(["provider.test", "other.test"]);
    expect(config.snsEventFormat).toBe("scaleway-tem");
  });

  it("keeps the route off when a setting is missing, the token is short, or the format is unknown", () => {
    expect(new EmailConfig({ NODE_ENV: "test" }).isSnsWebhookEnabled()).toBe(false);
    expect(new EmailConfig({ ...full, EMAIL_SNS_TOPIC_ARN: "" }).isSnsWebhookEnabled()).toBe(false);
    expect(new EmailConfig({ ...full, EMAIL_SNS_EVENT_FORMAT: "" }).isSnsWebhookEnabled()).toBe(false);
    const short = new EmailConfig({ ...full, EMAIL_SNS_WEBHOOK_TOKEN: "short" });
    expect(short.isSnsWebhookEnabled()).toBe(false);
    expect(short.snsWebhookToken).toBe("");
    const unknown = new EmailConfig({ ...full, EMAIL_SNS_EVENT_FORMAT: "made-up" });
    expect(unknown.isSnsWebhookEnabled()).toBe(false);
    expect(unknown.snsEventFormat).toBe("");
  });
});
