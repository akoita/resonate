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
    await request(app.getHttpServer()).get("/health").expect(200).expect({
      status: "ok",
    });
  });
});
