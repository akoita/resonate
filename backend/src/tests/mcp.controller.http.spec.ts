import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { McpController } from "../modules/mcp/mcp.controller";
import { McpService } from "../modules/mcp/mcp.service";
import { CatalogService } from "../modules/catalog/catalog.service";
import { createControllerTestApp } from "./e2e-helpers";

const mockCatalogService = {
  searchMcpCatalog: jest.fn(),
};

describe("McpController (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(McpController, [
      McpService,
      { provide: CatalogService, useValue: mockCatalogService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCatalogService.searchMcpCatalog.mockResolvedValue({
      items: [
        {
          id: "rel_1",
          title: "The Horizon Is Home",
          artist: "Resonate Artist",
          genre: "electronic",
          releaseDate: "2026-04-22T00:00:00.000Z",
          artworkUrl: "http://localhost:3000/catalog/releases/rel_1/artwork",
          trackCount: 4,
          licensable: true,
          deeplink: "http://localhost:3001/release/rel_1",
        },
      ],
    });
  });

  it("GET /mcp returns a curl-friendly capability object", async () => {
    const res = await request(app.getHttpServer()).get("/mcp").expect(200);

    expect(res.body).toEqual({
      protocolVersion: expect.any(String),
      serverInfo: {
        name: "resonate-mcp",
        version: "0.1.0",
      },
      tools: ["catalog.search"],
    });
  });

  it("serves catalog.search through Streamable HTTP MCP", async () => {
    const init = await request(app.getHttpServer())
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: {
            name: "jest",
            version: "0.0.1",
          },
        },
      })
      .expect(200);

    const sessionId = init.headers["mcp-session-id"];
    expect(sessionId).toEqual(expect.any(String));
    expect(init.body.result.serverInfo).toEqual({
      name: "resonate-mcp",
      version: "0.1.0",
    });

    await request(app.getHttpServer())
      .post("/mcp")
      .set("mcp-session-id", sessionId)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })
      .expect(202);

    const tools = await request(app.getHttpServer())
      .post("/mcp")
      .set("mcp-session-id", sessionId)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      })
      .expect(200);

    expect(tools.body.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "catalog.search",
          annotations: expect.objectContaining({ readOnlyHint: true }),
        }),
      ]),
    );

    const call = await request(app.getHttpServer())
      .post("/mcp")
      .set("mcp-session-id", sessionId)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "catalog.search",
          arguments: {
            query: "horizon",
            limit: 5,
          },
        },
      })
      .expect(200);

    expect(mockCatalogService.searchMcpCatalog).toHaveBeenCalledWith(
      "horizon",
      5,
    );
    expect(call.body.result.structuredContent.items[0]).toEqual(
      expect.objectContaining({
        id: "rel_1",
        licensable: true,
        deeplink: "http://localhost:3001/release/rel_1",
      }),
    );
  });

  it("bounds retained MCP sessions", async () => {
    (app.get(McpService) as any).maxSessions = 1;

    const initialize = async (id: number) =>
      request(app.getHttpServer())
        .post("/mcp")
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: {
              name: "jest",
              version: "0.0.1",
            },
          },
        })
        .expect(200);

    const first = await initialize(10);
    const second = await initialize(11);

    expect(first.headers["mcp-session-id"]).toEqual(expect.any(String));
    expect(second.headers["mcp-session-id"]).toEqual(expect.any(String));
    expect(second.headers["mcp-session-id"]).not.toBe(
      first.headers["mcp-session-id"],
    );

    await request(app.getHttpServer())
      .post("/mcp")
      .set("mcp-session-id", first.headers["mcp-session-id"])
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/list",
      })
      .expect(404);
  });
});
