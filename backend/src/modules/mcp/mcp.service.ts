import { Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CatalogService } from "../catalog/catalog.service";
import { AgentObservabilityService } from "../agents/agent_observability.service";
import { PaymentsService } from "../payments/payments.service";
import { X402Config } from "../x402/x402.config";
import { resolveX402AssetInfo, X402_RETRY_HEADERS } from "../x402/x402.public";
import {
  MCP_CAPABILITY_SCHEMA_VERSION,
  MCP_ERROR_DETAILS,
  MCP_ERROR_RECOVERY,
  MCP_LICENSE_TIERS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOL_DETAILS,
  MCP_TOOL_NAMES,
} from "./mcp.constants";
import { McpStemService, McpToolError } from "./mcp-stem.service";

const licenseTypeSchema = z.enum(["personal", "remix", "commercial"]);
const availableActionSchema = z.object({
  action: z.string(),
  description: z.string(),
  tool: z.string().optional(),
  method: z.string().optional(),
  href: z.string().optional(),
  requiresPayment: z.boolean().optional(),
});
const docsLinksSchema = z.object({
  mcp: z.string(),
  x402: z.string().optional(),
  externalAgentContract: z.string(),
  storefront: z.string().optional(),
});

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
    @Optional()
    private readonly x402Config?: X402Config,
    @Optional()
    private readonly paymentsService?: PaymentsService,
    @Optional()
    private readonly observability?: AgentObservabilityService,
  ) {}

  async onModuleDestroy() {
    await Promise.all(
      [...this.sessions.keys()].map((sessionId) =>
        this.disposeSession(sessionId),
      ),
    );
  }

  getCapabilities() {
    const payment = this.buildPaymentCapabilities();
    return {
      schemaVersion: MCP_CAPABILITY_SCHEMA_VERSION,
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: MCP_SERVER_INFO,
      tools: [...MCP_TOOL_NAMES],
      toolDetails: [...MCP_TOOL_DETAILS],
      licenseTiers: [...MCP_LICENSE_TIERS],
      payment,
      endpoints: {
        mcp: "/mcp",
        wellKnown: "/.well-known/mcp.json",
        openapi: "/openapi.json",
        storefront: "/api/storefront/stems",
        x402Info: "/api/stems/{stemId}/x402/info",
        x402Download: "/api/stems/{stemId}/x402",
      },
      docs: {
        mcp: "docs/architecture/mcp_server.md",
        x402: "docs/architecture/x402_payments.md",
        externalAgentUx:
          "docs/strategy/external_agent_application_ux_implementation_plan.md",
        registry: "docs/architecture/x402_registry_registration.md",
      },
      errors: [...MCP_ERROR_DETAILS],
      agentUx: {
        recommendedFlow: [
          "catalog.search",
          "GET /api/storefront/stems or GET /api/storefront/stems/{stemId}",
          "stem.quote or GET /api/stems/{stemId}/x402/info",
          "satisfy x402 challenge",
          "stem.download or GET /api/stems/{stemId}/x402 with proof",
          "store receipt and retry idempotently on transient failures",
        ],
        publicRouter: false,
        note:
          "PaymentRouterService is a trusted backend boundary; external agents use storefront, MCP, x402, and OpenAPI surfaces.",
      },
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
          summary: z.string(),
          availableActions: z.array(availableActionSchema),
          docs: docsLinksSchema,
          items: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              artist: z.string(),
              genre: z.string().nullable(),
              moods: z.array(z.string()),
              releaseDate: z.string().nullable(),
              artworkUrl: z.string().nullable(),
              trackCount: z.number().int(),
              licensable: z.boolean(),
              deeplink: z.string(),
              availableActions: z.array(availableActionSchema),
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
        return this.traceMcpTool("catalog.search", { query, limit }, async () => {
          const result = await this.catalogService.searchMcpCatalog(
            query,
            limit ?? 10,
          );
          const enhancedResult = this.enhanceCatalogSearchResult(result);

          return {
            structuredContent: enhancedResult,
            content: [
              {
                type: "text",
                text: JSON.stringify(enhancedResult, null, 2),
              },
            ],
          };
        });
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
          summary: z.string(),
          stemId: z.string(),
          licenseType: licenseTypeSchema,
          priceUsdc: z.string(),
          expiresAt: z.string(),
          availableActions: z.array(availableActionSchema),
          rights: z.object({
            licenseType: licenseTypeSchema,
            stemId: z.string(),
            artist: z.string().nullable(),
            trackTitle: z.string().nullable(),
            releaseTitle: z.string().nullable(),
            usage: z.string(),
            attribution: z.string(),
            constraints: z.array(z.string()),
          }),
          policy: z.object({
            paymentRequired: z.boolean(),
            proofRequiredForDownload: z.boolean(),
            quoteExpiresAt: z.string(),
            retry: z.string(),
            publicRouter: z.boolean(),
          }),
          docs: docsLinksSchema,
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
        return this.traceMcpTool("stem.quote", { stemId, licenseType }, async () => {
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
            if (error instanceof McpToolError) {
              return this.toolError(
                error.code,
                error.message,
                error.context,
              );
            }
            return this.toolError(
              "QUOTE_FAILED",
              error instanceof Error ? error.message : String(error),
            );
          }
        });
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
        outputSchema: {
          summary: z.string(),
          stemId: z.string(),
          licenseType: licenseTypeSchema,
          receiptId: z.string(),
          availableActions: z.array(availableActionSchema),
          receiptVerification: z.object({
            receiptId: z.string(),
            encodedReceiptPresent: z.boolean(),
            paymentProofSha256: z.string().nullable(),
            settlementStatus: z.string(),
            licenseKey: licenseTypeSchema,
            paymentAsset: z.record(z.string(), z.unknown()),
            resource: z.object({
              uri: z.string(),
              mimeType: z.string(),
              bytes: z.number().int(),
            }),
            checklist: z.array(z.string()),
          }),
          docs: docsLinksSchema,
          receipt: z.record(z.string(), z.unknown()),
          resource: z.object({
            uri: z.string(),
            name: z.string(),
            mimeType: z.string(),
            bytes: z.number().int(),
          }),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ stemId, licenseType, paymentProof }) => {
        return this.traceMcpTool("stem.download", { stemId, licenseType, paymentProof }, async () => {
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
            if (error instanceof McpToolError) {
              return this.toolError(
                error.code,
                error.message,
                error.context,
              );
            }
            return this.toolError(
              "DOWNLOAD_FAILED",
              error instanceof Error ? error.message : String(error),
            );
          }
        });
      },
    );

    return server;
  }

  private enhanceCatalogSearchResult(result: {
    items: Array<{
      id: string;
      title: string;
      artist: string;
      licensable: boolean;
      deeplink: string;
      [key: string]: unknown;
    }>;
  }) {
    return {
      summary: `Found ${result.items.length} public release${result.items.length === 1 ? "" : "s"} matching the catalog query.`,
      availableActions: [
        {
          action: "open_release",
          description:
            "Open a release deeplink to inspect the listener-facing page.",
        },
        {
          action: "inspect_storefront_stems",
          description:
            "Use the storefront stem APIs to find purchasable stem IDs, license tiers, quote URLs, and purchase URLs.",
          method: "GET",
          href: "/api/storefront/stems",
        },
      ],
      docs: {
        mcp: "docs/architecture/mcp_server.md",
        externalAgentContract:
          "docs/architecture/external_agent_application_contract.md",
        storefront: "docs/architecture/x402_payments.md",
      },
      items: result.items.map((item) => ({
        ...item,
        availableActions: [
          {
            action: "open_release",
            description:
              "Open this release in the Resonate web app for human review.",
            href: item.deeplink,
          },
          ...(item.licensable
            ? [
                {
                  action: "inspect_storefront_stems",
                  description:
                    "Query storefront stems to choose a concrete stem before calling stem.quote.",
                  method: "GET",
                  href: `/api/storefront/stems?q=${encodeURIComponent(item.title)}`,
                },
              ]
            : [
                {
                  action: "continue_catalog_search",
                  description:
                    "This release is not currently marked licensable; search or inspect other releases before payment planning.",
                },
              ]),
        ],
      })),
    };
  }

  private toolError(
    code: keyof typeof MCP_ERROR_RECOVERY,
    message: string,
    context?: Record<string, unknown>,
  ) {
    const structuredContent = {
      code,
      message,
      recovery: MCP_ERROR_RECOVERY[code],
      ...(context ? { context } : {}),
    };
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

  private async traceMcpTool<T>(
    toolName: string,
    input: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date();
    try {
      const output = await run();
      await this.observability?.traceToolCall({
        toolName,
        input,
        output,
        startedAt,
        endedAt: new Date(),
      });
      return output;
    } catch (error) {
      await this.observability?.traceToolCall({
        toolName,
        input,
        error,
        startedAt,
        endedAt: new Date(),
      });
      throw error;
    }
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

  private buildPaymentCapabilities() {
    if (!this.x402Config) {
      return {
        protocol: "x402",
        enabled: false,
        retryHeaders: [...X402_RETRY_HEADERS],
      };
    }

    const asset = resolveX402AssetInfo(
      this.x402Config.network,
      this.paymentsService?.getPaymentAssets(this.x402Config.chainId).assets,
    );

    return {
      protocol: "x402",
      enabled: this.x402Config.enabled,
      network: this.x402Config.network,
      chainId: this.x402Config.chainId,
      facilitatorUrl: this.x402Config.facilitatorUrl,
      retryHeaders: [...X402_RETRY_HEADERS],
      contractSettlementEnabled: this.x402Config.contractSettlementEnabled,
      asset,
    };
  }
}
