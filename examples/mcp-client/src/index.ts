import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const LICENSE_TYPES = ["personal", "remix", "commercial"] as const;
type LicenseType = (typeof LICENSE_TYPES)[number];
type ToolCallResult = {
  structuredContent?: unknown;
  content?: unknown;
  isError?: boolean;
};

const mcpUrl = process.env.RESONATE_MCP_URL ?? "http://localhost:3000/mcp";
const query = process.env.RESONATE_MCP_QUERY ?? "resonate";
const limit = readPositiveInteger("RESONATE_MCP_LIMIT", 3);
const stemId = optionalEnv("RESONATE_MCP_STEM_ID");
const licenseType = readLicenseType("RESONATE_MCP_LICENSE_TYPE", "remix");
const paymentProof = optionalEnv("RESONATE_MCP_PAYMENT_PROOF");

const client = new Client({
  name: "resonate-mcp-client-example",
  version: "0.1.0",
});

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);

  const tools = await client.listTools();
  printStep("tools.list", {
    mcpUrl,
    tools: tools.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
    })),
  });

  const searchResult = await callTool("catalog.search", { query, limit });
  printStep("catalog.search", summarizeToolResult(searchResult));

  if (!stemId) {
    printStep("next", {
      skipped: ["stem.quote", "stem.download"],
      reason:
        "Set RESONATE_MCP_STEM_ID to run the optional quote and payment-required examples.",
    });
    return;
  }

  const quoteResult = await callTool("stem.quote", {
    stemId,
    licenseType,
  });
  printStep("stem.quote", summarizeToolResult(quoteResult));

  const missingProofResult = await callTool("stem.download", {
    stemId,
    licenseType,
  });
  printStep("stem.download.missingProof", summarizeToolResult(missingProofResult));

  if (!paymentProof) {
    printStep("next", {
      skipped: ["stem.download.paid"],
      reason:
        "Set RESONATE_MCP_PAYMENT_PROOF to opt in to a paid download attempt.",
    });
    return;
  }

  const paidDownloadResult = await callTool("stem.download", {
    stemId,
    licenseType,
    paymentProof,
  });
  printStep("stem.download.paid", summarizeToolResult(paidDownloadResult));
  printStep("receipt", extractReceiptSummary(paidDownloadResult));
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return client.callTool({
    name,
    arguments: args,
  }) as Promise<ToolCallResult>;
}

function summarizeToolResult(result: ToolCallResult) {
  return {
    isError: result.isError ?? false,
    structuredContent: sanitizeStructuredContent(result.structuredContent),
    content: summarizeContent(result.content),
  };
}

function sanitizeStructuredContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeStructuredContent);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "paymentProof" || key === "paymentHeader") {
        return [key, "[redacted]"];
      }
      return [key, sanitizeStructuredContent(entry)];
    }),
  );
}

function summarizeContent(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    if (item.type === "resource" && isRecord(item.resource)) {
      const { blob, ...resource } = item.resource;
      return {
        ...item,
        resource: {
          ...resource,
          blobBytesBase64: typeof blob === "string" ? blob.length : undefined,
          blob: blob ? "[omitted]" : undefined,
        },
      };
    }
    return item;
  });
}

function extractReceiptSummary(result: ToolCallResult) {
  const structuredContent = result.structuredContent;
  if (!isRecord(structuredContent) || result.isError) {
    return {
      available: false,
      reason: "Paid download did not return successful receipt content.",
    };
  }

  const receipt = structuredContent.receipt;
  const license = isRecord(receipt) ? receipt.license : undefined;
  const payment = isRecord(receipt) ? receipt.payment : undefined;
  const settlement = isRecord(receipt) ? receipt.settlement : undefined;
  const resource = structuredContent.resource;

  return {
    available: true,
    receiptId: structuredContent.receiptId,
    encodedReceiptPresent:
      isRecord(receipt) && typeof receipt.encoded === "string",
    licenseKey: isRecord(license) ? license.key : undefined,
    amount: isRecord(payment) ? payment.amount : undefined,
    currency: isRecord(payment) ? payment.currency : undefined,
    settlementStatus: isRecord(settlement) ? settlement.status : undefined,
    resource: isRecord(resource)
      ? {
          uri: resource.uri,
          mimeType: resource.mimeType,
          bytes: resource.bytes,
        }
      : undefined,
  };
}

function printStep(step: string, value: unknown) {
  console.log(JSON.stringify({ step, ...wrapValue(value) }, null, 2));
}

function wrapValue(value: unknown) {
  return isRecord(value) ? value : { value };
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readLicenseType(name: string, fallback: LicenseType): LicenseType {
  const value = process.env[name] ?? fallback;
  if (!LICENSE_TYPES.includes(value as LicenseType)) {
    throw new Error(`${name} must be one of: ${LICENSE_TYPES.join(", ")}`);
  }
  return value as LicenseType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

try {
  await main();
} finally {
  await client.close();
}
