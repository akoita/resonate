import type { PaymentAsset } from "../payments/payments.service";
import { resolveX402AssetInfo, X402_RETRY_HEADERS } from "../x402/x402.public";
import { MCP_AGENT_UX_NOTE, MCP_RECOMMENDED_AGENT_FLOW } from "./mcp.constants";

/**
 * Shared builders for the parts of the MCP capability contract that are
 * published identically by `GET /mcp` (McpService.getCapabilities) and
 * `/.well-known/mcp.json` (OpenApiService.buildMcpWellKnownDocument).
 *
 * Only genuinely common fields live here; the two documents legitimately differ
 * elsewhere (well-known adds transport/discovery/documentation, `GET /mcp` adds
 * endpoints and repo-relative docs).
 */

/** Structural subset of X402Config needed to describe the payment rail. */
export type McpPaymentConfig = {
  enabled: boolean;
  network: string;
  chainId: number;
  facilitatorUrl: string;
  contractSettlementEnabled: boolean;
};

export function buildMcpAgentUx() {
  return {
    recommendedFlow: [...MCP_RECOMMENDED_AGENT_FLOW],
    publicRouter: false,
    note: MCP_AGENT_UX_NOTE,
  };
}

export function buildMcpPaymentCapabilities(
  config?: McpPaymentConfig,
  paymentAssets?: PaymentAsset[],
) {
  if (!config) {
    return {
      protocol: "x402",
      enabled: false,
      retryHeaders: [...X402_RETRY_HEADERS],
    };
  }

  return {
    protocol: "x402",
    enabled: config.enabled,
    network: config.network,
    chainId: config.chainId,
    facilitatorUrl: config.facilitatorUrl,
    retryHeaders: [...X402_RETRY_HEADERS],
    contractSettlementEnabled: config.contractSettlementEnabled,
    asset: resolveX402AssetInfo(config.network, paymentAssets),
  };
}
