import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CatalogService } from "../catalog/catalog.service";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOL_NAMES,
} from "./mcp.constants";
import { McpStemService } from "./mcp-stem.service";

const licenseTypeSchema = z.enum(["personal", "remix", "commercial"]);

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastSeenAt: number;
};

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private readonly sessions = new Map<string, McpSession>();
  private readonly maxSessions = 100;
  private readonly sessionTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly catalogService: CatalogService,
    private readonly stemService: McpStemService,
  ) {}

  async onModuleDestroy() {
    await Promise.all(
      [...this.sessions.keys()].map((sessionId) =>
        this.disposeSession(sessionId),
      ),
    );
  }

  getCapabilities() {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: MCP_SERVER_INFO,
      tools: [...MCP_TOOL_NAMES],
    };
  }

  async handlePost(req: Request, res: Response) {
    const sessionId = this.getSessionId(req);
    const now = Date.now();
    await this.pruneExpiredSessions(now);

    try {
      if (sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
          res.status(404).json(this.jsonRpcError("Unknown MCP session", null));
          return;
        }

        session.lastSeenAt = now;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res
          .status(400)
          .json(this.jsonRpcError("Bad Request: initialize required", null));
        return;
      }

      await this.enforceSessionLimit();
      const server = this.createServer();
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          const initializedAt = Date.now();
          this.sessions.set(initializedSessionId, {
            server,
            transport,
            createdAt: initializedAt,
            lastSeenAt: initializedAt,
          });
        },
        onsessionclosed: (closedSessionId) => {
          void this.disposeSession(closedSessionId);
        },
      });

      transport.onclose = () => {
        const initializedSessionId = transport.sessionId;
        if (initializedSessionId) {
          void this.disposeSession(initializedSessionId);
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(
        `MCP POST failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.headersSent) {
        res.status(500).json(this.jsonRpcError("Internal server error", null));
      }
    }
  }

  async handleSessionRequest(req: Request, res: Response) {
    const sessionId = this.getSessionId(req);
    await this.pruneExpiredSessions(Date.now());
    if (!sessionId) {
      res.status(400).send("Missing MCP session ID");
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      res.status(404).send("Unknown MCP session");
      return;
    }

    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(req, res);
  }

  private createServer() {
    const server = new McpServer(MCP_SERVER_INFO, {
      capabilities: {
        tools: {},
      },
    });

    server.registerTool(
      "catalog.search",
      {
        title: "Search Catalog",
        description:
          "Search public Resonate releases by title, artist, genre, or track title.",
        inputSchema: {
          query: z.string().describe("Search text for releases, artists, genres, or tracks."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(25)
            .optional()
            .describe("Maximum number of releases to return. Defaults to 10."),
        },
        outputSchema: {
          items: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              artist: z.string(),
              genre: z.string().nullable(),
              releaseDate: z.string().nullable(),
              artworkUrl: z.string().nullable(),
              trackCount: z.number().int(),
              licensable: z.boolean(),
              deeplink: z.string(),
            }),
          ),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, limit }) => {
        const result = await this.catalogService.searchMcpCatalog(
          query,
          limit ?? 10,
        );

        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    );

    server.registerTool(
      "stem.quote",
      {
        title: "Quote Stem License",
        description:
          "Return a USDC quote and x402 payment challenge for a stem license.",
        inputSchema: {
          stemId: z.string().describe("Resonate stem ID to quote."),
          licenseType: licenseTypeSchema
            .optional()
            .describe("License tier to quote. Defaults to personal."),
        },
        outputSchema: {
          stemId: z.string(),
          licenseType: licenseTypeSchema,
          priceUsdc: z.string(),
          expiresAt: z.string(),
          paymentChallenge: z.object({
            scheme: z.literal("x402"),
            facilitatorUrl: z.string(),
            paymentRequirements: z.record(z.string(), z.unknown()),
          }),
          stem: z.object({
            title: z.string().nullable(),
            type: z.string(),
            trackTitle: z.string().nullable(),
            artist: z.string().nullable(),
            releaseTitle: z.string().nullable(),
            mimeType: z.string(),
          }),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ stemId, licenseType }) => {
        try {
          const result = await this.stemService.quote(
            stemId,
            licenseType ?? "personal",
          );
          return {
            structuredContent: result,
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return this.toolError(
            "QUOTE_FAILED",
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    );

    server.registerTool(
      "stem.download",
      {
        title: "Download Paid Stem",
        description:
          "Validate an x402 payment proof and return the purchased stem as an MCP resource.",
        inputSchema: {
          stemId: z.string().describe("Resonate stem ID to download."),
          licenseType: licenseTypeSchema
            .optional()
            .describe("License tier being purchased. Defaults to personal."),
          paymentProof: z
            .string()
            .optional()
            .describe(
              "x402 PAYMENT-SIGNATURE or legacy X-PAYMENT proof returned by the payment client.",
            ),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ stemId, licenseType, paymentProof }) => {
        try {
          const result = await this.stemService.download(
            stemId,
            licenseType ?? "personal",
            paymentProof,
          );
          return {
            structuredContent: result.structuredContent,
            content: result.content as any,
            isError: !result.ok,
          };
        } catch (error) {
          return this.toolError(
            "DOWNLOAD_FAILED",
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    );

    return server;
  }

  private toolError(code: string, message: string) {
    const structuredContent = { code, message };
    return {
      structuredContent,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
      isError: true,
    };
  }

  private getSessionId(req: Request): string | undefined {
    const header = req.headers["mcp-session-id"];
    if (Array.isArray(header)) {
      return header[0];
    }
    return header;
  }

  private async pruneExpiredSessions(now: number) {
    const expiredSessionIds = [...this.sessions.entries()]
      .filter(([, session]) => now - session.lastSeenAt > this.sessionTtlMs)
      .map(([sessionId]) => sessionId);

    await Promise.all(
      expiredSessionIds.map((sessionId) => this.disposeSession(sessionId)),
    );
  }

  private async enforceSessionLimit() {
    if (this.sessions.size < this.maxSessions) {
      return;
    }

    const [oldestSessionId] = [...this.sessions.entries()].sort(
      ([, a], [, b]) => a.lastSeenAt - b.lastSeenAt,
    )[0];
    await this.disposeSession(oldestSessionId);
  }

  private async disposeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    await session.transport.close().catch(() => undefined);
    await session.server.close().catch(() => undefined);
  }

  private jsonRpcError(message: string, id: string | number | null) {
    return {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
      },
      id,
    };
  }
}
