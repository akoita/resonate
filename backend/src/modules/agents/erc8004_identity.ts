import { Buffer } from "node:buffer";
import { type AgentConfig, Prisma } from "@prisma/client";

export type AgentRegistrationFile = Prisma.InputJsonObject & {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: Array<{ name: string; endpoint: string; version?: string }>;
  x402Support: boolean;
  active: boolean;
  registrations: Array<{ agentId: number | string; agentRegistry: string }>;
  supportedTrust: string[];
  capabilities?: string[];
  agentAddress?: string;
};

export const ERC8004_MAINNET_IDENTITY_REGISTRY =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export const ERC8004_TESTNET_IDENTITY_REGISTRY =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const ERC8004_MAINNET_CHAIN_IDS = [1, 56, 137, 143, 8453];
const ERC8004_TESTNET_CHAIN_IDS = [97, 80002, 10143, 84532, 11155111];

export const ERC8004_IDENTITY_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentURI", type: "string" },
      {
        name: "metadata",
        type: "tuple[]",
        components: [
          { name: "metadataKey", type: "string" },
          { name: "metadataValue", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getMetadata",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "function",
    name: "setMetadata",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "metadataKey", type: "string" },
      { name: "metadataValue", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "URIUpdated",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "newURI", type: "string", indexed: false },
      { name: "updatedBy", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "MetadataSet",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "indexedMetadataKey", type: "string", indexed: true },
      { name: "metadataKey", type: "string", indexed: false },
      { name: "metadataValue", type: "bytes", indexed: false },
    ],
  },
] as const;

export function isErc8004Testnet(chainId: number): boolean {
  return ERC8004_TESTNET_CHAIN_IDS.includes(chainId);
}

export function defaultErc8004IdentityRegistry(chainId: number): string | null {
  if (ERC8004_TESTNET_CHAIN_IDS.includes(chainId)) return ERC8004_TESTNET_IDENTITY_REGISTRY;
  if (ERC8004_MAINNET_CHAIN_IDS.includes(chainId)) return ERC8004_MAINNET_IDENTITY_REGISTRY;
  return null;
}

export function buildAgentRegistryId(chainId: number, registry: string): string {
  return `eip155:${chainId}:${registry}`;
}

export function toCaip10Address(chainId: number, address: string): string {
  return `eip155:${chainId}:${address}`;
}

export function buildAgentRegistrationFile(input: {
  config: Pick<AgentConfig, "id" | "name" | "vibes" | "stemTypes" | "isActive" | "identityTokenId">;
  chainId: number | null;
  registry: string | null;
  publicBaseUrl?: string | null;
  agentAddress?: string | null;
  capabilities?: string[];
  description?: string;
  image?: string;
}): AgentRegistrationFile {
  const publicBaseUrl = input.publicBaseUrl?.replace(/\/$/, "");
  const registrations =
    input.chainId && input.registry && input.config.identityTokenId
      ? [{
        agentId: input.config.identityTokenId,
        agentRegistry: buildAgentRegistryId(input.chainId, input.registry),
      }]
      : [];

  const services: AgentRegistrationFile["services"] = [];
  if (publicBaseUrl) {
    services.push(
      { name: "web", endpoint: publicBaseUrl },
      { name: "MCP", endpoint: `${publicBaseUrl}/mcp`, version: "2025-06-18" },
    );
  }

  const capabilities = input.capabilities?.length
    ? Array.from(new Set(input.capabilities.filter(Boolean)))
    : ["curation", "negotiation", "mcp.catalog.search", "mcp.stem.quote", "mcp.stem.download"];

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: input.config.name,
    description:
      input.description ||
      `Resonate AI DJ agent for ${input.config.vibes.join(", ") || "music curation"}.`,
    image: input.image || (publicBaseUrl ? `${publicBaseUrl}/icon.png` : ""),
    services,
    x402Support: true,
    active: input.config.isActive,
    registrations,
    supportedTrust: ["reputation"],
    capabilities,
    ...(input.chainId && input.agentAddress
      ? { agentAddress: toCaip10Address(input.chainId, input.agentAddress) }
      : {}),
  };
}

export function toDataUriJson(value: unknown): string {
  const json = JSON.stringify(value);
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}
