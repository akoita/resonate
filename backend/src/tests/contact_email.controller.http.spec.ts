/**
 * Email notices HTTP contract (#2169): routing, guards, DTO validation and the
 * webhook signature gate. The service is mocked here; the behaviour behind it
 * is covered by `email_notices.integration.spec.ts` against real Postgres.
 */
import { createHmac } from "crypto";
import request from "supertest";
import { HttpException, INestApplication } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AccountStatusInterceptor } from "../modules/accounts/account_status.interceptor";
import { AccountStatusService } from "../modules/accounts/account_status.service";
import { ContactEmailController } from "../modules/email/contact_email.controller";
import { ContactEmailService } from "../modules/email/contact_email.service";
import { EmailConfig } from "../modules/email/email_config";
import { EmailDeliveryService } from "../modules/email/email_delivery.service";
import { EmailPublicController } from "../modules/email/email_public.controller";
import { EmailSnsService } from "../modules/email/email_sns.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const STATE = {
  available: true,
  address: "me@example.test",
  status: "pending",
  disabledReason: null,
  confirmationSentAt: null,
  categories: [],
};

const mockContacts = {
  getState: jest.fn().mockResolvedValue(STATE),
  setAddress: jest.fn().mockResolvedValue(STATE),
  resend: jest.fn().mockResolvedValue(STATE),
  remove: jest.fn().mockResolvedValue(undefined),
  setPreferences: jest.fn().mockResolvedValue(STATE),
  confirm: jest.fn().mockResolvedValue({ status: "confirmed" }),
  unsubscribe: jest.fn().mockResolvedValue({ category: "policy", status: "unsubscribed" }),
};
const mockDelivery = {
  handleProviderEvents: jest.fn().mockResolvedValue({ received: 1, disabled: 1, ignored: 0 }),
};
const mockAccounts = { getEffective: jest.fn().mockResolvedValue({ status: "suspended", until: null }) };

const WEBHOOK_SECRET = "webhook-secret-for-tests";

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Email notices (http)", () => {
  let app: INestApplication;
  let noSecretApp: INestApplication;

  const providers = (webhookSecret: string) => [
    { provide: ContactEmailService, useValue: mockContacts },
    { provide: EmailDeliveryService, useValue: mockDelivery },
    { provide: EmailConfig, useValue: { webhookSecret } },
    // The SNS route has its own spec (email_sns.controller.http.spec.ts).
    { provide: EmailSnsService, useValue: {} },
    { provide: AccountStatusService, useValue: mockAccounts },
    { provide: APP_INTERCEPTOR, useClass: AccountStatusInterceptor },
  ];

  beforeAll(async () => {
    app = await createControllerTestApp(
      [ContactEmailController, EmailPublicController],
      providers(WEBHOOK_SECRET),
      { rawBody: true },
    );
    noSecretApp = await createControllerTestApp([EmailPublicController], providers(""), { rawBody: true });
  });

  afterAll(async () => {
    await app.close();
    await noSecretApp.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId = "user-1") => ({ Authorization: `Bearer ${authToken(userId)}` });

  describe("/me/contact-email", () => {
    it("requires a JWT on every route", async () => {
      await request(server()).get("/me/contact-email").expect(401);
      await request(server()).put("/me/contact-email").send({ address: "a@b.example" }).expect(401);
      await request(server()).post("/me/contact-email/resend").expect(401);
      await request(server()).delete("/me/contact-email").expect(401);
      await request(server()).put("/me/contact-email/preferences").send({ optOuts: [] }).expect(401);
      expect(mockContacts.setAddress).not.toHaveBeenCalled();
    });

    it("reads the caller's own state", async () => {
      const res = await request(server()).get("/me/contact-email").set(bearer("user-7")).expect(200);
      expect(res.body.status).toBe("pending");
      expect(mockContacts.getState).toHaveBeenCalledWith("user-7");
    });

    it("sets the address for the caller, trimming surrounding spaces in the service", async () => {
      await request(server()).put("/me/contact-email").set(bearer("user-7")).send({ address: " me@example.test " }).expect(200);
      expect(mockContacts.setAddress).toHaveBeenCalledWith("user-7", " me@example.test ");
    });

    it("passes through the 429 shape when the per-account limit is hit", async () => {
      const limited = () =>
        new HttpException({ code: "email_rate_limited", message: "Too many confirmation emails. Try again later.", retryAfterSeconds: 42 }, 429);
      mockContacts.setAddress.mockRejectedValueOnce(limited());
      mockContacts.resend.mockRejectedValueOnce(limited());
      const set = await request(server()).put("/me/contact-email").set(bearer()).send({ address: "me@example.test" }).expect(429);
      expect(set.body).toMatchObject({ code: "email_rate_limited", retryAfterSeconds: 42 });
      const resend = await request(server()).post("/me/contact-email/resend").set(bearer()).expect(429);
      expect(resend.body).toMatchObject({ code: "email_rate_limited", retryAfterSeconds: 42 });
    });

    it.each([
      ["a missing address", {}],
      ["a non-string address", { address: 5 }],
      ["a malformed address", { address: "not-an-email" }],
      ["an address over 254 characters", { address: `${"a".repeat(250)}@example.test` }],
    ])("rejects %s with 400", async (_name, body) => {
      await request(server()).put("/me/contact-email").set(bearer()).send(body).expect(400);
      expect(mockContacts.setAddress).not.toHaveBeenCalled();
    });

    it("rejects preferences that are not an array of strings with 400", async () => {
      for (const body of [{}, { optOuts: "policy" }, { optOuts: [1] }]) {
        await request(server()).put("/me/contact-email/preferences").set(bearer()).send(body).expect(400);
      }
      expect(mockContacts.setPreferences).not.toHaveBeenCalled();
    });

    it("saves preferences and resends and removes for the caller", async () => {
      await request(server()).put("/me/contact-email/preferences").set(bearer("u2")).send({ optOuts: ["policy"] }).expect(200);
      expect(mockContacts.setPreferences).toHaveBeenCalledWith("u2", ["policy"]);
      const resent = await request(server()).post("/me/contact-email/resend").set(bearer("u2")).expect(200);
      expect(resent.body.status).toBe("pending");
      await request(server()).delete("/me/contact-email").set(bearer("u2")).expect(204);
      expect(mockContacts.remove).toHaveBeenCalledWith("u2");
    });

    it("still works for a suspended account (the routes are allowed while suspended)", async () => {
      await request(server()).put("/me/contact-email").set(bearer()).send({ address: "me@example.test" }).expect(200);
      await request(server()).post("/me/contact-email/resend").set(bearer()).expect(200);
      await request(server()).put("/me/contact-email/preferences").set(bearer()).send({ optOuts: [] }).expect(200);
      await request(server()).delete("/me/contact-email").set(bearer()).expect(204);
      // The interceptor is registered and the account is suspended; the decorator makes it skip the lookup.
      expect(mockAccounts.getEffective).not.toHaveBeenCalled();
    });
  });

  describe("public /email routes", () => {
    it("reject a malformed body with 400 before the service runs", async () => {
      await request(server()).post("/email/confirm").send({}).expect(400);
      await request(server()).post("/email/confirm").send({ token: 5 }).expect(400);
      await request(server()).post("/email/unsubscribe").send({}).expect(400);
      expect(mockContacts.confirm).not.toHaveBeenCalled();
      expect(mockContacts.unsubscribe).not.toHaveBeenCalled();
    });

    it("pass the token through without a session", async () => {
      await request(server()).post("/email/confirm").send({ token: "abc" }).expect(200, { status: "confirmed" });
      expect(mockContacts.confirm).toHaveBeenCalledWith("abc");
      await request(server()).post("/email/unsubscribe").send({ token: "abc" }).expect(200);
      expect(mockContacts.unsubscribe).toHaveBeenCalledWith("abc");
    });

    it("accepts RFC 8058 one-click with the token in the query and the body ignored", async () => {
      await request(server())
        .post("/email/unsubscribe/one-click?token=tok123")
        .type("form")
        .send("List-Unsubscribe=One-Click")
        .expect(200);
      expect(mockContacts.unsubscribe).toHaveBeenCalledWith("tok123");
    });
  });

  describe("POST /email/webhook", () => {
    const body = JSON.stringify({ events: [{ type: "bounce", email: "gone@example.test", bounceType: "hard" }] });

    it("answers 503 when the webhook secret is not configured", async () => {
      await request(noSecretApp.getHttpServer())
        .post("/email/webhook")
        .set("Content-Type", "application/json")
        .set("X-Resonate-Signature", sign(body))
        .send(body)
        .expect(503);
      expect(mockDelivery.handleProviderEvents).not.toHaveBeenCalled();
    });

    it("answers 401 for a missing or wrong signature, or a body changed after signing", async () => {
      const post = () => request(server()).post("/email/webhook").set("Content-Type", "application/json");
      await post().send(body).expect(401);
      await post().set("X-Resonate-Signature", sign(body, "wrong-secret")).send(body).expect(401);
      await post().set("X-Resonate-Signature", "sha256=nothex").send(body).expect(401);
      await post().set("X-Resonate-Signature", sign(body)).send(body.replace("gone", "else")).expect(401);
      expect(mockDelivery.handleProviderEvents).not.toHaveBeenCalled();
    });

    it("processes a correctly signed body", async () => {
      const res = await request(server())
        .post("/email/webhook")
        .set("Content-Type", "application/json")
        .set("X-Resonate-Signature", sign(body))
        .send(body)
        .expect(200);
      expect(res.body).toEqual({ received: 1, disabled: 1, ignored: 0 });
      expect(mockDelivery.handleProviderEvents).toHaveBeenCalledWith([
        { type: "bounce", email: "gone@example.test", bounceType: "hard" },
      ]);
    });

    it("answers 400 for a signed body that is not the event contract", async () => {
      const bad = JSON.stringify({ events: [{ type: "open", email: "a@b.example" }] });
      await request(server())
        .post("/email/webhook")
        .set("Content-Type", "application/json")
        .set("X-Resonate-Signature", sign(bad))
        .send(bad)
        .expect(400);
    });
  });
});

describe("Email notices: required categories (http, real service validation)", () => {
  it("rejects opting out of a required category with 400", async () => {
    const service = new ContactEmailService({ isAvailable: () => true } as unknown as EmailConfig, null, {} as never);
    const app = await createControllerTestApp(ContactEmailController, [{ provide: ContactEmailService, useValue: service }]);
    try {
      for (const optOuts of [["terms"], ["account"], ["policy", "account"]]) {
        const res = await request(app.getHttpServer())
          .put("/me/contact-email/preferences")
          .set({ Authorization: `Bearer ${authToken("user-1")}` })
          .send({ optOuts })
          .expect(400);
        expect(res.body.code).toBe("required_category");
      }
      await request(app.getHttpServer())
        .put("/me/contact-email/preferences")
        .set({ Authorization: `Bearer ${authToken("user-1")}` })
        .send({ optOuts: ["nonsense"] })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});
