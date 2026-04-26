import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  hexToString,
  http,
  isAddress,
  stringToHex,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import {
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  foundry,
  mainnet,
  polygon,
  polygonAmoy,
  sepolia,
} from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  ERC8004_IDENTITY_ABI,
  buildAgentRegistrationFile,
  buildAgentRegistryId,
  defaultErc8004IdentityRegistry,
  toDataUriJson,
} from "../src/modules/agents/erc8004_identity";

type CliOptions = {
  smartAccount?: string;
  network?: string;
  chainId?: number;
  registry?: string;
  rpcUrl?: string;
  privateKey?: string;
  name?: string;
  description?: string;
  capabilities?: string[];
  publicBaseUrl?: string;
  agentUri?: string;
  mockIpfs?: boolean;
  help?: boolean;
};

type RegisteredArgs = {
  agentId: bigint;
  agentURI: string;
  owner: Address;
};

const NETWORK_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  mainnet: 1,
  sepolia: 11155111,
  base: 8453,
  "base-sepolia": 84532,
  "base_sepolia": 84532,
  polygon: 137,
  "polygon-amoy": 80002,
  "polygon_amoy": 80002,
  bnb: 56,
  bsc: 56,
  monad: 143,
  "monad-mainnet": 143,
  "monad_mainnet": 143,
  "bnb-testnet": 97,
  "bsc-testnet": 97,
  "bnb_testnet": 97,
  "bsc_testnet": 97,
  "monad-testnet": 10143,
  "monad_testnet": 10143,
  anvil: 31337,
  local: 31337,
};

function printHelp(): void {
  console.log(`
Mint a Resonate agent ERC-8004 Identity Registry token.

Usage:
  npx ts-node-dev --transpile-only scripts/mint-agent-identity.ts \\
    --network base-sepolia \\
    --smart-account 0x... \\
    --name "Resonate DJ Agent" \\
    --mock-ipfs

Required:
  --smart-account  Address to link in the registration metadata.
  --rpc-url        RPC URL, or ERC8004_RPC_URL / RPC_URL / <NETWORK>_RPC_URL.
  --private-key    Transaction signer, or ERC8004_PRIVATE_KEY / PRIVATE_KEY.

Options:
  --network        ethereum, sepolia, base, base-sepolia, polygon, polygon-amoy, bsc, bsc-testnet, monad-testnet, anvil.
  --chain-id       Explicit chain ID. Overrides --network.
  --registry       Identity Registry address. Defaults to the official ERC-8004 mainnet/testnet registry for the chain.
  --capabilities   Comma-separated capability names.
  --public-base-url Public Resonate URL to place in the registration file.
  --agent-uri      Existing registration URI to set after mint.
  --mock-ipfs      Use a deterministic ipfs:// URI placeholder and print the JSON to pin later.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--mock-ipfs") {
      options.mockIpfs = true;
    } else if (arg === "--smart-account" && next) {
      options.smartAccount = next;
      i += 1;
    } else if (arg === "--network" && next) {
      options.network = next;
      i += 1;
    } else if (arg === "--chain-id" && next) {
      options.chainId = Number(next);
      i += 1;
    } else if (arg === "--registry" && next) {
      options.registry = next;
      i += 1;
    } else if (arg === "--rpc-url" && next) {
      options.rpcUrl = next;
      i += 1;
    } else if (arg === "--private-key" && next) {
      options.privateKey = next;
      i += 1;
    } else if (arg === "--name" && next) {
      options.name = next;
      i += 1;
    } else if (arg === "--description" && next) {
      options.description = next;
      i += 1;
    } else if (arg === "--capabilities" && next) {
      options.capabilities = next.split(",").map((value) => value.trim()).filter(Boolean);
      i += 1;
    } else if (arg === "--public-base-url" && next) {
      options.publicBaseUrl = next;
      i += 1;
    } else if (arg === "--agent-uri" && next) {
      options.agentUri = next;
      i += 1;
    }
  }
  return options;
}

function normalizePrivateKey(value: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("private key must be a 32-byte hex string");
  }
  return normalized as Hex;
}

function resolveChainId(options: CliOptions): number {
  if (options.chainId && Number.isFinite(options.chainId)) return options.chainId;
  const envChainId = process.env.ERC8004_CHAIN_ID || process.env.AA_CHAIN_ID || process.env.CHAIN_ID;
  if (envChainId) return Number(envChainId);
  const network = (options.network || process.env.ERC8004_NETWORK || "base-sepolia").toLowerCase();
  const chainId = NETWORK_CHAIN_IDS[network];
  if (!chainId) {
    throw new Error(`Unknown ERC-8004 network "${network}". Pass --chain-id to use a custom chain.`);
  }
  return chainId;
}

function envRpcUrl(network?: string): string | undefined {
  const normalized = network?.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  if (normalized) {
    const networkSpecific = process.env[`${normalized}_RPC_URL`];
    if (networkSpecific) return networkSpecific;
  }
  return process.env.ERC8004_RPC_URL || process.env.RPC_URL || process.env.LOCAL_RPC_URL;
}

function chainFor(chainId: number, rpcUrl: string): Chain {
  const rpcUrls = { default: { http: [rpcUrl] } };
  if (chainId === mainnet.id) return { ...mainnet, rpcUrls };
  if (chainId === sepolia.id) return { ...sepolia, rpcUrls };
  if (chainId === base.id) return { ...base, rpcUrls };
  if (chainId === baseSepolia.id) return { ...baseSepolia, rpcUrls };
  if (chainId === polygon.id) return { ...polygon, rpcUrls };
  if (chainId === polygonAmoy.id) return { ...polygonAmoy, rpcUrls };
  if (chainId === bsc.id) return { ...bsc, rpcUrls };
  if (chainId === bscTestnet.id) return { ...bscTestnet, rpcUrls };
  if (chainId === foundry.id) return { ...foundry, rpcUrls };
  return {
    id: chainId,
    name: `EVM ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls,
  };
}

async function parseRegisteredAgentId(input: {
  publicClient: ReturnType<typeof createPublicClient>;
  registry: Address;
  hash: Hex;
}): Promise<bigint> {
  const receipt = await input.publicClient.waitForTransactionReceipt({ hash: input.hash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== input.registry.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC8004_IDENTITY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "Registered") {
        return (decoded.args as RegisteredArgs).agentId;
      }
    } catch {
      // Ignore ERC-721 Transfer and unrelated logs in the same receipt.
    }
  }
  throw new Error(`Register transaction ${input.hash} did not emit ERC-8004 Registered`);
}

export async function main(argv = process.argv): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const chainId = resolveChainId(options);
  const network = options.network || process.env.ERC8004_NETWORK;
  const rpcUrl = options.rpcUrl || envRpcUrl(network);
  const privateKey = options.privateKey || process.env.ERC8004_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const smartAccount = options.smartAccount || process.env.SMART_ACCOUNT_ADDRESS;
  const registry = options.registry || process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS || defaultErc8004IdentityRegistry(chainId);

  if (!rpcUrl) throw new Error("Missing RPC URL. Pass --rpc-url or set ERC8004_RPC_URL.");
  if (!privateKey) throw new Error("Missing signer private key. Pass --private-key or set ERC8004_PRIVATE_KEY.");
  if (!smartAccount || !isAddress(smartAccount)) throw new Error("Missing or invalid --smart-account address.");
  if (!registry) throw new Error("Missing registry. Pass --registry for unsupported ERC-8004 chain IDs.");
  if (!isAddress(registry)) throw new Error("Missing or invalid ERC-8004 Identity Registry address.");

  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  const chain = chainFor(chainId, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const registerHash = await walletClient.writeContract({
    address: registry,
    abi: ERC8004_IDENTITY_ABI,
    functionName: "register",
    args: [],
  });
  const agentId = await parseRegisteredAgentId({ publicClient, registry, hash: registerHash });

  const registrationFile = buildAgentRegistrationFile({
    config: {
      id: `erc8004-${chainId}-${agentId.toString()}`,
      name: options.name || "Resonate Agent",
      vibes: [],
      stemTypes: [],
      isActive: true,
      identityTokenId: agentId.toString(),
    },
    chainId,
    registry,
    publicBaseUrl: options.publicBaseUrl || process.env.ERC8004_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL,
    agentAddress: smartAccount,
    capabilities: options.capabilities,
    description: options.description,
  });
  const agentUri =
    options.agentUri ||
    (options.mockIpfs
      ? `ipfs://resonate-agent-${chainId}-${agentId.toString()}`
      : toDataUriJson(registrationFile));

  const uriHash = await walletClient.writeContract({
    address: registry,
    abi: ERC8004_IDENTITY_ABI,
    functionName: "setAgentURI",
    args: [agentId, agentUri],
  });
  await publicClient.waitForTransactionReceipt({ hash: uriHash });

  const metadataHash = await walletClient.writeContract({
    address: registry,
    abi: ERC8004_IDENTITY_ABI,
    functionName: "setMetadata",
    args: [agentId, "resonate.smartAccount", stringToHex(smartAccount)],
  });
  await publicClient.waitForTransactionReceipt({ hash: metadataHash });

  const [tokenUri, owner, agentWallet, smartAccountMetadata] = await Promise.all([
    publicClient.readContract({
      address: registry,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    }),
    publicClient.readContract({
      address: registry,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    }),
    publicClient.readContract({
      address: registry,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "getAgentWallet",
      args: [agentId],
    }),
    publicClient.readContract({
      address: registry,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "getMetadata",
      args: [agentId, "resonate.smartAccount"],
    }),
  ]);

  console.log(JSON.stringify({
    chainId,
    registry,
    agentRegistry: buildAgentRegistryId(chainId, registry),
    agentId: agentId.toString(),
    smartAccount,
    signer: account.address,
    owner,
    agentWallet,
    tokenUri,
    smartAccountMetadata: smartAccountMetadata === "0x" ? null : hexToString(smartAccountMetadata as Hex),
    transactions: {
      register: registerHash,
      setAgentURI: uriHash,
      setSmartAccountMetadata: metadataHash,
    },
    registrationFile,
    pinningRequired: Boolean(options.mockIpfs),
  }, null, 2));
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
