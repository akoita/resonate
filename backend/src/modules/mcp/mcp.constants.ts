import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

export const MCP_SERVER_INFO = {
  name: "resonate-mcp",
  version: "0.1.0",
};

export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

export const MCP_TOOL_NAMES = [
  "catalog.search",
  "stem.quote",
  "stem.download",
] as const;

export const MCP_CAPABILITY_SCHEMA_VERSION =
  "resonate-mcp-capabilities/v1";

export const MCP_LICENSE_TIERS = [
  "personal",
  "remix",
  "commercial",
] as const;

export const MCP_TOOL_DETAILS = [
  {
    name: "catalog.search",
    version: "1.0.0",
    authMode: "none",
    payment: "free",
    summary:
      "Search public Resonate releases by title, artist, genre, or track title.",
    nextActions: ["open_release", "inspect_storefront_stems"],
  },
  {
    name: "stem.quote",
    version: "1.0.0",
    authMode: "none",
    payment: "free",
    summary:
      "Return a USDC quote, license tier, expiration, and x402 payment challenge for a stem.",
    nextActions: ["satisfy_x402_challenge", "call_stem.download"],
  },
  {
    name: "stem.download",
    version: "1.0.0",
    authMode: "x402-tool-proof",
    payment: "x402",
    summary:
      "Validate an x402 proof and return the purchased stem resource plus receipt metadata.",
    nextActions: ["store_receipt", "retry_idempotently_on_network_failure"],
  },
] as const;

export const MCP_ERROR_DETAILS = [
  {
    code: "PAYMENT_REQUIRED",
    recovery:
      "Call stem.quote, satisfy the returned x402 challenge, then retry stem.download with paymentProof.",
  },
  {
    code: "QUOTE_FAILED",
    recovery:
      "Check stemId, licenseType, and x402 availability before retrying quote.",
  },
  {
    code: "DOWNLOAD_FAILED",
    recovery:
      "Retry with backoff if transient; include the stem ID and receipt ID when reporting persistent failures.",
  },
  {
    code: "X402_DISABLED",
    recovery:
      "Do not attempt paid download on this origin; use discovery-only flows or wait for an enabled validation origin.",
  },
  {
    code: "RESOURCE_NOT_FOUND",
    recovery: "Re-run discovery or use a fresh storefront/stem ID.",
  },
  {
    code: "RESOURCE_UNAVAILABLE",
    recovery:
      "The stem exists but is not downloadable through this rail; choose another public storefront item.",
  },
  {
    code: "LICENSE_UNAVAILABLE",
    recovery: "Choose one of the advertised license tiers.",
  },
  {
    code: "CHALLENGE_EXPIRED",
    recovery: "Request a fresh stem.quote before paying.",
  },
  {
    code: "PAYMENT_PROOF_INVALID",
    recovery:
      "Recreate the x402 proof against the current payment requirements.",
  },
  {
    code: "FACILITATOR_FAILED",
    recovery:
      "Retry later or surface facilitator/network failure to the human user.",
  },
  {
    code: "SETTLEMENT_FAILED",
    recovery:
      "Do not serve the stem; inspect settlement status and retry only if idempotency permits.",
  },
  {
    code: "INTERNAL_ERROR",
    recovery:
      "Retry with backoff and include request or receipt identifiers in operator reports.",
  },
] as const;
