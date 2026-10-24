import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { AdminStepUpController } from "../modules/admin_step_up/admin_step_up.controller";
import { AdminStepUpService } from "../modules/admin_step_up/admin_step_up.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const VALID = {
  address: "0x" + "a".repeat(40),
  signature: "0x" + "b".repeat(130),
  challengeToken: "x".repeat(64),
};

const mockStepUp = {
  challenge: jest.fn().mockResolvedValue({ address: VALID.address, message: "m", challengeToken: "t", expiresAt: "e" }),
  verify: jest.fn().mockResolvedValue({ proof: "p", expiresAt: "e", ttlSeconds: 300 }),
};

describe("AdminStepUpController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(AdminStepUpController, [
      { provide: AdminStepUpService, useValue: mockStepUp },
      RolesGuard,
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId: string, role: string) => ({ Authorization: `Bearer ${authToken(userId, role)}` });

  const routes: Array<[string, Record<string, unknown>]> = [
    ["/admin/step-up/challenge", {}],
    ["/admin/step-up/verify", VALID],
  ];

  it.each(routes)("%s requires a JWT (401)", async (path, body) => {
    await request(server()).post(path).send(body).expect(401);
  });

  it.each(["listener", "artist", "curator", "agent"])("rejects the %s role (403)", async (role) => {
    for (const [path, body] of routes) {
      await request(server()).post(path).set(bearer("u-1", role)).send(body).expect(403);
    }
    expect(mockStepUp.challenge).not.toHaveBeenCalled();
    expect(mockStepUp.verify).not.toHaveBeenCalled();
  });

  it.each(["admin", "operator"])("serves the %s role, for the signed-in person only", async (role) => {
    await request(server()).post("/admin/step-up/challenge").set(bearer("who-1", role)).expect(200);
    expect(mockStepUp.challenge).toHaveBeenCalledWith("who-1");

    const res = await request(server()).post("/admin/step-up/verify").set(bearer("who-1", role)).send(VALID).expect(200);
    expect(res.body).toEqual({ proof: "p", expiresAt: "e", ttlSeconds: 300 });
    expect(mockStepUp.verify).toHaveBeenCalledWith("who-1", expect.objectContaining(VALID));
  });

  describe("validation (400)", () => {
    it.each([
      ["no body", {}],
      ["a missing challenge token", { ...VALID, challengeToken: undefined }],
      ["a missing signature", { ...VALID, signature: undefined }],
      ["a non-hex signature", { ...VALID, signature: "hello" }],
      ["a malformed address", { ...VALID, address: "0x123" }],
      ["a numeric signature", { ...VALID, signature: 5 }],
      ["an over-long signature", { ...VALID, signature: "0x" + "b".repeat(20_001) }],
    ])("rejects %s", async (_label, body) => {
      await request(server()).post("/admin/step-up/verify").set(bearer("who-1", "admin")).send(body).expect(400);
      expect(mockStepUp.verify).not.toHaveBeenCalled();
    });
  });
});
