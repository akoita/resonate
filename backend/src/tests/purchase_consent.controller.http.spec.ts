import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PurchaseConsentController } from "../modules/purchase_consent/purchase_consent.controller";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { PURCHASE_CONSENT_WORDING } from "../modules/purchase_consent/purchase_consent.constants";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const service = {
  wording: jest.fn(),
  record: jest.fn(),
  link: jest.fn(),
  listForUser: jest.fn(),
};

const validBody = {
  surface: "stem_purchase",
  subjectId: "stem-1",
  consented: true,
  acknowledgedWaiver: true,
  textVersion: PURCHASE_CONSENT_WORDING.version,
};

describe("PurchaseConsentController (HTTP contract, #1776)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PurchaseConsentController, [
      { provide: PurchaseConsentService, useValue: service },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.wording.mockReturnValue(PURCHASE_CONSENT_WORDING);
    service.record.mockResolvedValue({ id: "c1" });
    service.link.mockResolvedValue({ id: "c1" });
    service.listForUser.mockResolvedValue({ items: [] });
  });

  it("serves the wording to anyone, with its version and review status", async () => {
    const res = await request(app.getHttpServer()).get("/purchase-consents/wording").expect(200);
    expect(res.body.version).toBe(PURCHASE_CONSENT_WORDING.version);
    expect(res.body.reviewStatus).toBe("for_legal_review_before_production");
  });

  it("401 without a JWT on record, link and list", async () => {
    await request(app.getHttpServer()).post("/purchase-consents").send(validBody).expect(401);
    await request(app.getHttpServer()).post("/purchase-consents/c1/link").send({}).expect(401);
    await request(app.getHttpServer()).get("/purchase-consents").expect(401);
    expect(service.record).not.toHaveBeenCalled();
  });

  it("records the caller's own consent", async () => {
    await request(app.getHttpServer())
      .post("/purchase-consents")
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .send(validBody)
      .expect(201);
    expect(service.record).toHaveBeenCalledWith("user-1", expect.objectContaining({ surface: "stem_purchase" }));
  });

  it.each([
    ["unknown surface", { surface: "gift_card" }],
    ["missing subject", { subjectId: "" }],
    ["non-boolean consent", { consented: "yes" }],
    ["missing acknowledgement flag", { acknowledgedWaiver: undefined }],
    ["unknown licence tier", { licenseType: "free-for-all" }],
    ["overlong label", { subjectLabel: "x".repeat(121) }],
  ])("400 for %s", async (_name, patch) => {
    await request(app.getHttpServer())
      .post("/purchase-consents")
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .send({ ...validBody, ...patch })
      .expect(400);
    expect(service.record).not.toHaveBeenCalled();
  });

  it("400 for a malformed transaction hash when linking", async () => {
    await request(app.getHttpServer())
      .post("/purchase-consents/c1/link")
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .send({ transactionHash: "0x123" })
      .expect(400);
    expect(service.link).not.toHaveBeenCalled();
  });

  it("links only through the caller's own id", async () => {
    await request(app.getHttpServer())
      .post("/purchase-consents/c1/link")
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .send({ transactionHash: `0x${"a".repeat(64)}` })
      .expect(200);
    expect(service.link).toHaveBeenCalledWith("user-1", "c1", { transactionHash: `0x${"a".repeat(64)}` });
  });

  it("lists only the caller's records", async () => {
    await request(app.getHttpServer())
      .get("/purchase-consents")
      .set("Authorization", `Bearer ${authToken("user-2")}`)
      .expect(200);
    expect(service.listForUser).toHaveBeenCalledWith("user-2");
  });
});
