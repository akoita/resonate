import { Controller, Get, INestApplication, Res } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Response } from "express";
import request from "supertest";
import { API_SECURITY_HEADERS, securityHeadersMiddleware } from "../modules/shared/security_headers.middleware";

describe("API security headers", () => {
  @Controller()
  class ProbeController {
    @Get("json")
    json() {
      return { ok: true };
    }

    @Get("custom")
    custom(@Res() res: Response) {
      res.setHeader("Content-Security-Policy", "default-src 'self'");
      res.send("ok");
    }
  }

  let nest: INestApplication;
  const app = () => nest.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    nest = moduleRef.createNestApplication();
    nest.getHttpAdapter().getInstance().disable("x-powered-by");
    nest.use(securityHeadersMiddleware());
    await nest.init();
  });

  afterAll(async () => {
    await nest.close();
  });

  it("sets every header on a normal response", async () => {
    const response = await request(app()).get("/json").expect(200);
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      expect(response.headers[name.toLowerCase()]).toBe(value);
    }
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("lets the web app load media cross-origin", () => {
    expect(API_SECURITY_HEADERS["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
  });

  it("sets headers on unknown routes too", async () => {
    const response = await request(app()).get("/missing").expect(404);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("lets a handler override a header for its own response", async () => {
    const response = await request(app()).get("/custom").expect(200);
    expect(response.headers["content-security-policy"]).toBe("default-src 'self'");
  });
});
