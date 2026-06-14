import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../modules/app.module";
import { INestApplication } from "@nestjs/common";

describe("Health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ok", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: "ok",
        appVersion: expect.any(String),
        environmentId: expect.any(String),
        dataEpoch: expect.any(String),
      }),
    );
    // Defaults make the stamp meaningful even without env vars set (#1199).
    expect(res.body.environmentId.length).toBeGreaterThan(0);
    expect(res.body.dataEpoch.length).toBeGreaterThan(0);
  });
});
