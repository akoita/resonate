import { Controller, INestApplication, Post } from "@nestjs/common";
import request from "supertest";
import { createControllerTestApp } from "./e2e-helpers";
import { ProductSurfacesController } from "../modules/product_surfaces/product_surfaces.controller";
import { RequireSurface } from "../modules/product_surfaces/product_surface.guard";

@Controller("surface-probe")
class SurfaceProbeController {
  @RequireSurface("showsPledging")
  @Post()
  probe() {
    return { ok: true };
  }
}

describe("product surfaces over HTTP (#2658)", () => {
  let app: INestApplication;
  const saved = { ...process.env };

  beforeAll(async () => {
    app = await createControllerTestApp([ProductSurfacesController, SurfaceProbeController], []);
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports every surface on by default", async () => {
    delete process.env.RESONATE_ENVIRONMENT_ID;
    const res = await request(app.getHttpServer()).get("/config/surfaces").expect(200);
    expect(res.body.surfaces).toEqual({
      showsPledging: true,
      paidCollects: true,
      stemPurchases: true,
      wallet: true,
      agentPayments: true,
      aiGeneration: true,
    });
  });

  it("reports production defaults off and an explicit opt-in on", async () => {
    process.env.RESONATE_ENVIRONMENT_ID = "prod";
    process.env.WALLET_ENABLED = "true";
    const res = await request(app.getHttpServer()).get("/config/surfaces").expect(200);
    expect(res.body.surfaces.wallet).toBe(true);
    expect(res.body.surfaces.showsPledging).toBe(false);
  });

  it("refuses a gated route with a typed 403 and restores it when switched back on", async () => {
    process.env.SHOWS_PLEDGING_ENABLED = "false";
    const refused = await request(app.getHttpServer()).post("/surface-probe").expect(403);
    expect(refused.body).toMatchObject({ code: "surface_disabled", surface: "showsPledging" });

    process.env.SHOWS_PLEDGING_ENABLED = "true";
    await request(app.getHttpServer()).post("/surface-probe").expect(201);
  });
});
