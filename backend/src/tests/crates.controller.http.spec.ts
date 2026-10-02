/**
 * CratesController — HTTP Contract Test (#1962)
 *
 * Tests the HTTP contract: guards (401 without a JWT), DTO validation (400),
 * identity from the JWT, and 404 passthrough. The service is mocked; its
 * behavior is covered by crates.integration.spec.ts.
 */

import request from "supertest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { CratesController } from "../modules/crates/crates.controller";
import { CrateQuoteService } from "../modules/crates/crate_quote.service";
import { CratesService } from "../modules/crates/crates.service";
import { createControllerTestApp, authToken } from "./e2e-helpers";

const mockCrates = {
  createFromRequest: jest.fn(),
  getCrate: jest.fn(),
  listCrates: jest.fn(),
  updateCrate: jest.fn(),
  swapItem: jest.fn(),
};

const mockQuotes = {
  createQuote: jest.fn(),
  getQuote: jest.fn(),
  settleQuote: jest.fn(),
};

describe("CratesController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(CratesController, [
      { provide: CratesService, useValue: mockCrates },
      { provide: CrateQuoteService, useValue: mockQuotes },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    mockCrates.createFromRequest.mockResolvedValue({
      crate: { id: "crate-1", items: [] },
      request: { id: "req-1", source: "text", parserStrategy: "deterministic", unparsed: [] },
      coverage: { requested: 8, found: 0, gaps: [] },
    });
    mockCrates.getCrate.mockResolvedValue({ crate: { id: "crate-1", items: [] } });
    mockCrates.listCrates.mockResolvedValue({ crates: [] });
    mockCrates.updateCrate.mockResolvedValue({ crate: { id: "crate-1", items: [] } });
    mockCrates.swapItem.mockResolvedValue({ crate: { id: "crate-1", items: [] }, swapped: true });
    mockQuotes.createQuote.mockResolvedValue({ id: "q-1", crateId: "crate-1", status: "open", lines: [] });
    mockQuotes.getQuote.mockResolvedValue({ id: "q-1", crateId: "crate-1", status: "open", lines: [] });
    mockQuotes.settleQuote.mockResolvedValue({ id: "q-1", crateId: "crate-1", status: "settled", lines: [] });
  });

  const token = authToken("dj-1");

  it("POST /crates/requests -> 401 without JWT", async () => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .send({ text: "deep house" })
      .expect(401);
    expect(mockCrates.createFromRequest).not.toHaveBeenCalled();
  });

  it("GET /crates/:id -> 401 without JWT", async () => {
    await request(app.getHttpServer()).get("/crates/crate-1").expect(401);
    expect(mockCrates.getCrate).not.toHaveBeenCalled();
  });

  it("POST /crates/requests -> 201 and passes the JWT user and the body to the service", async () => {
    const res = await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "deep house around 122 bpm", count: 6 })
      .expect(201);

    expect(res.body.crate.id).toBe("crate-1");
    expect(mockCrates.createFromRequest).toHaveBeenCalledWith(
      "dj-1",
      expect.objectContaining({ text: "deep house around 122 bpm", count: 6 }),
    );
  });

  it("POST /crates/requests -> userId comes from the token, not the body", async () => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ referenceTrackId: "track-1", userId: "someone-else" })
      .expect(201);

    expect(mockCrates.createFromRequest.mock.calls[0][0]).toBe("dj-1");
  });

  it("POST /crates/requests -> accepts a filters body", async () => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ filters: { count: 4, verifiedHumanOnly: true } })
      .expect(201);

    expect(mockCrates.createFromRequest).toHaveBeenCalledWith(
      "dj-1",
      expect.objectContaining({ filters: { count: 4, verifiedHumanOnly: true } }),
    );
  });

  it("POST /crates/requests -> 400 for text over 500 characters", async () => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "x".repeat(501) })
      .expect(400);
    expect(mockCrates.createFromRequest).not.toHaveBeenCalled();
  });

  it("POST /crates/requests -> accepts text of exactly 500 characters", async () => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "x".repeat(500) })
      .expect(201);
  });

  it.each([0, 26, -1, 2.5, "8"])("POST /crates/requests -> 400 for count %p", async (count) => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "deep house", count })
      .expect(400);
    expect(mockCrates.createFromRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["text", { text: 5 }],
    ["referenceTrackId", { referenceTrackId: 5 }],
    ["filters (string)", { filters: "bpm" }],
    ["filters (array)", { filters: [] }],
  ])("POST /crates/requests -> 400 for a wrongly typed %s", async (_name, body) => {
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send(body)
      .expect(400);
    expect(mockCrates.createFromRequest).not.toHaveBeenCalled();
  });

  it("POST /crates/requests -> passes a service 404 through", async () => {
    mockCrates.createFromRequest.mockRejectedValue(
      new NotFoundException("Reference track not found"),
    );
    await request(app.getHttpServer())
      .post("/crates/requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ referenceTrackId: "missing" })
      .expect(404);
  });

  it("GET /crates/:id -> 200 and scopes the lookup to the JWT user", async () => {
    const res = await request(app.getHttpServer())
      .get("/crates/crate-1")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.crate.id).toBe("crate-1");
    expect(mockCrates.getCrate).toHaveBeenCalledWith("dj-1", "crate-1");
  });

  it("GET /crates/:id -> passes a service 404 through", async () => {
    mockCrates.getCrate.mockRejectedValue(new NotFoundException("Crate not found"));
    await request(app.getHttpServer())
      .get("/crates/someone-elses")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  describe("GET /crates", () => {
    it("-> 401 without JWT", async () => {
      await request(app.getHttpServer()).get("/crates").expect(401);
      expect(mockCrates.listCrates).not.toHaveBeenCalled();
    });

    it("-> 200 and lists for the JWT user", async () => {
      mockCrates.listCrates.mockResolvedValue({ crates: [{ id: "crate-1" }] });
      const res = await request(app.getHttpServer())
        .get("/crates")
        .query({ userId: "someone-else" })
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body.crates).toEqual([{ id: "crate-1" }]);
      expect(mockCrates.listCrates).toHaveBeenCalledWith("dj-1");
    });
  });

  describe("PATCH /crates/:id", () => {
    it("-> 401 without JWT", async () => {
      await request(app.getHttpServer()).patch("/crates/crate-1").send({ title: "x" }).expect(401);
      expect(mockCrates.updateCrate).not.toHaveBeenCalled();
    });

    it("-> 200 and passes the JWT user, the id and the body to the service", async () => {
      const body = {
        title: "Friday",
        status: "saved",
        items: [{ trackId: "t2", locked: true }, { trackId: "t1" }],
      };
      const res = await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(200);
      expect(res.body.crate.id).toBe("crate-1");
      expect(mockCrates.updateCrate).toHaveBeenCalledWith(
        "dj-1",
        "crate-1",
        expect.objectContaining(body),
      );
    });

    it("-> userId comes from the token, not the body", async () => {
      await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "x", userId: "someone-else" })
        .expect(200);
      expect(mockCrates.updateCrate.mock.calls[0][0]).toBe("dj-1");
    });

    it("-> accepts a title of exactly 80 characters and a null title", async () => {
      await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "x".repeat(80) })
        .expect(200);
      await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: null })
        .expect(200);
    });

    it("-> 400 for a title over 80 characters", async () => {
      await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "x".repeat(81) })
        .expect(400);
      expect(mockCrates.updateCrate).not.toHaveBeenCalled();
    });

    it.each([
      ["status", { status: "archived" }],
      ["title type", { title: 5 }],
      ["items type", { items: "t1" }],
      ["item shape", { items: ["t1"] }],
      ["item trackId", { items: [{ locked: true }] }],
      ["item locked", { items: [{ trackId: "t1", locked: "yes" }] }],
      ["items length", { items: Array.from({ length: 26 }, (_, i) => ({ trackId: `t${i}` })) }],
    ])("-> 400 for an invalid %s", async (_name, body) => {
      await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(400);
      expect(mockCrates.updateCrate).not.toHaveBeenCalled();
    });

    it("-> passes a service 404, 400 invalid_items and 403 pro_required through", async () => {
      mockCrates.updateCrate.mockRejectedValueOnce(new NotFoundException("Crate not found"));
      await request(app.getHttpServer())
        .patch("/crates/someone-elses")
        .set("Authorization", `Bearer ${token}`)
        .send({ title: "x" })
        .expect(404);

      mockCrates.updateCrate.mockRejectedValueOnce(
        new BadRequestException({ code: "invalid_items" }),
      );
      const invalid = await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send({ items: [{ trackId: "nope" }] })
        .expect(400);
      expect(invalid.body.code).toBe("invalid_items");

      mockCrates.updateCrate.mockRejectedValueOnce(
        new ForbiddenException({ code: "pro_required" }),
      );
      const pro = await request(app.getHttpServer())
        .patch("/crates/crate-1")
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "saved" })
        .expect(403);
      expect(pro.body.code).toBe("pro_required");
    });
  });

  describe("POST /crates/:id/items/:trackId/swap", () => {
    it("-> 401 without JWT", async () => {
      await request(app.getHttpServer()).post("/crates/crate-1/items/t1/swap").expect(401);
      expect(mockCrates.swapItem).not.toHaveBeenCalled();
    });

    it("-> passes the JWT user, the crate and the line to the service", async () => {
      const res = await request(app.getHttpServer())
        .post("/crates/crate-1/items/t1/swap")
        .set("Authorization", `Bearer ${token}`)
        .send({ userId: "someone-else" })
        .expect(201);
      expect(res.body.swapped).toBe(true);
      expect(mockCrates.swapItem).toHaveBeenCalledWith("dj-1", "crate-1", "t1");
    });

    it("-> passes a service 404 and 409 line_locked through", async () => {
      mockCrates.swapItem.mockRejectedValueOnce(new NotFoundException("Crate not found"));
      await request(app.getHttpServer())
        .post("/crates/someone-elses/items/t1/swap")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);

      mockCrates.swapItem.mockRejectedValueOnce(new ConflictException({ code: "line_locked" }));
      const locked = await request(app.getHttpServer())
        .post("/crates/crate-1/items/t1/swap")
        .set("Authorization", `Bearer ${token}`)
        .expect(409);
      expect(locked.body.code).toBe("line_locked");
    });
  });

  describe("crate quotes (#1964)", () => {
    const hash = `0x${"ab".repeat(32)}`;

    it("POST /crates/:id/quote -> 401 without JWT", async () => {
      await request(app.getHttpServer()).post("/crates/crate-1/quote").send({}).expect(401);
      expect(mockQuotes.createQuote).not.toHaveBeenCalled();
    });

    it("POST /crates/:id/quote -> 201, JWT user and body passed to the service", async () => {
      const lines = [{ trackId: "t1", licenseType: "remix", stemTypes: ["vocals", "drums"] }];
      const res = await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({ lines, userId: "someone-else" })
        .expect(201);
      expect(res.body.id).toBe("q-1");
      expect(mockQuotes.createQuote).toHaveBeenCalledWith(
        "dj-1",
        "crate-1",
        expect.objectContaining({ lines }),
      );
    });

    it("POST /crates/:id/quote -> passes a valid buyerAddress through, and a 409 wallet_mismatch", async () => {
      const buyerAddress = `0x${"Ab".repeat(20)}`;
      await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({ buyerAddress })
        .expect(201);
      expect(mockQuotes.createQuote).toHaveBeenCalledWith("dj-1", "crate-1", expect.objectContaining({ buyerAddress }));

      mockQuotes.createQuote.mockRejectedValueOnce(new ConflictException({ code: "wallet_mismatch" }));
      const mismatch = await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({ buyerAddress })
        .expect(409);
      expect(mismatch.body.code).toBe("wallet_mismatch");
    });

    it("POST /crates/:id/quote -> accepts an empty body (every line)", async () => {
      await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(201);
    });

    it.each([
      ["buyerAddress type", { buyerAddress: 5 }],
      ["buyerAddress short", { buyerAddress: "0x1234" }],
      ["buyerAddress non-hex", { buyerAddress: `0x${"zz".repeat(20)}` }],
      ["buyerAddress without prefix", { buyerAddress: "ab".repeat(20) }],
      ["lines type", { lines: "t1" }],
      ["empty lines", { lines: [] }],
      ["too many lines", { lines: Array.from({ length: 26 }, (_, i) => ({ trackId: `t${i}` })) }],
      ["line shape", { lines: ["t1"] }],
      ["line trackId", { lines: [{ licenseType: "remix" }] }],
      ["line trackId length", { lines: [{ trackId: "x".repeat(201) }] }],
      ["licenseType", { lines: [{ trackId: "t1", licenseType: "free" }] }],
      ["stemTypes type", { lines: [{ trackId: "t1", stemTypes: "vocals" }] }],
      ["stemTypes value", { lines: [{ trackId: "t1", stemTypes: ["original"] }] }],
      [
        "stemTypes length",
        { lines: [{ trackId: "t1", stemTypes: Array(7).fill("vocals") }] },
      ],
    ])("POST /crates/:id/quote -> 400 for an invalid %s", async (_name, body) => {
      await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(400);
      expect(mockQuotes.createQuote).not.toHaveBeenCalled();
    });

    it("POST /crates/:id/quote -> passes 404, 409 no_wallet, 503 and 400 invalid_lines through", async () => {
      mockQuotes.createQuote.mockRejectedValueOnce(new NotFoundException("Crate not found"));
      await request(app.getHttpServer())
        .post("/crates/someone-elses/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(404);

      mockQuotes.createQuote.mockRejectedValueOnce(new ConflictException({ code: "no_wallet" }));
      const noWallet = await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(409);
      expect(noWallet.body.code).toBe("no_wallet");

      mockQuotes.createQuote.mockRejectedValueOnce(
        new ServiceUnavailableException({ code: "marketplace_unavailable" }),
      );
      const unavailable = await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({})
        .expect(503);
      expect(unavailable.body.code).toBe("marketplace_unavailable");

      mockQuotes.createQuote.mockRejectedValueOnce(
        new BadRequestException({ code: "invalid_lines" }),
      );
      const invalid = await request(app.getHttpServer())
        .post("/crates/crate-1/quote")
        .set("Authorization", `Bearer ${token}`)
        .send({ lines: [{ trackId: "not-in-crate" }] })
        .expect(400);
      expect(invalid.body.code).toBe("invalid_lines");
    });

    it("GET /crates/:id/quotes/:quoteId -> 401 without JWT, else scoped to the JWT user", async () => {
      await request(app.getHttpServer()).get("/crates/crate-1/quotes/q-1").expect(401);
      const res = await request(app.getHttpServer())
        .get("/crates/crate-1/quotes/q-1")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(res.body.id).toBe("q-1");
      expect(mockQuotes.getQuote).toHaveBeenCalledWith("dj-1", "crate-1", "q-1");
    });

    it("GET /crates/:id/quotes/:quoteId -> passes a service 404 through", async () => {
      mockQuotes.getQuote.mockRejectedValue(new NotFoundException("Crate quote not found"));
      await request(app.getHttpServer())
        .get("/crates/crate-1/quotes/someone-elses")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });

    it("POST settle -> 401 without JWT", async () => {
      await request(app.getHttpServer())
        .post("/crates/crate-1/quotes/q-1/settle")
        .send({ transactionHash: hash })
        .expect(401);
      expect(mockQuotes.settleQuote).not.toHaveBeenCalled();
    });

    it("POST settle -> 200 for a final quote and passes user, ids and body to the service", async () => {
      const dropped = [{ quoteLineId: "line-1", reason: "deselected" }];
      const res = await request(app.getHttpServer())
        .post("/crates/crate-1/quotes/q-1/settle")
        .set("Authorization", `Bearer ${token}`)
        .send({ transactionHash: hash, dropped, userId: "someone-else" })
        .expect(200);
      expect(res.body.status).toBe("settled");
      expect(mockQuotes.settleQuote).toHaveBeenCalledWith(
        "dj-1",
        "crate-1",
        "q-1",
        expect.objectContaining({ transactionHash: hash, dropped }),
      );
    });

    it("POST settle -> 202 while the transaction has no receipt yet", async () => {
      mockQuotes.settleQuote.mockResolvedValue({ id: "q-1", status: "submitted", lines: [] });
      const res = await request(app.getHttpServer())
        .post("/crates/crate-1/quotes/q-1/settle")
        .set("Authorization", `Bearer ${token}`)
        .send({ transactionHash: hash })
        .expect(202);
      expect(res.body.status).toBe("submitted");
    });

    it.each([
      ["missing hash", {}],
      ["short hash", { transactionHash: "0x1234" }],
      ["non-hex hash", { transactionHash: `0x${"zz".repeat(32)}` }],
      ["hash type", { transactionHash: 5 }],
      ["dropped type", { transactionHash: hash, dropped: "line-1" }],
      ["dropped shape", { transactionHash: hash, dropped: ["line-1"] }],
      ["dropped reason", { transactionHash: hash, dropped: [{ quoteLineId: "l", reason: "nope" }] }],
      ["dropped id", { transactionHash: hash, dropped: [{ reason: "deselected" }] }],
      [
        "dropped length",
        {
          transactionHash: hash,
          dropped: Array.from({ length: 151 }, (_, i) => ({ quoteLineId: `l${i}`, reason: "deselected" })),
        },
      ],
    ])("POST settle -> 400 for an invalid %s", async (_name, body) => {
      await request(app.getHttpServer())
        .post("/crates/crate-1/quotes/q-1/settle")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(400);
      expect(mockQuotes.settleQuote).not.toHaveBeenCalled();
    });

    it("POST settle -> passes 404 and 409 already_submitted through", async () => {
      mockQuotes.settleQuote.mockRejectedValueOnce(new NotFoundException("Crate quote not found"));
      await request(app.getHttpServer())
        .post("/crates/crate-1/quotes/other/settle")
        .set("Authorization", `Bearer ${token}`)
        .send({ transactionHash: hash })
        .expect(404);

      mockQuotes.settleQuote.mockRejectedValueOnce(
        new ConflictException({ code: "already_submitted" }),
      );
      const conflict = await request(app.getHttpServer())
        .post("/crates/crate-1/quotes/q-1/settle")
        .set("Authorization", `Bearer ${token}`)
        .send({ transactionHash: hash })
        .expect(409);
      expect(conflict.body.code).toBe("already_submitted");
    });
  });
});
