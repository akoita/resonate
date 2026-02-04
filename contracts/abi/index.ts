/**
 * Resonate Protocol Contract ABIs
 * 
 * Generated from Foundry build output.
 * Import these ABIs in your frontend/backend to interact with deployed contracts.
 */

// ============ StemNFT (ERC-1155 + EIP-2981) ============
export const StemNFTABI = [
  // Read functions
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "uri",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "royaltyInfo",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "salePrice", type: "uint256" },
    ],
    outputs: [
      { name: "receiver", type: "address" },
      { name: "royaltyAmount", type: "uint256" },
    ],
  },
  {
    name: "stems",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "royaltyReceiver", type: "address" },
      { name: "royaltyBps", type: "uint96" },
      { name: "remixable", type: "bool" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    name: "isRemix",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getParentIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getCreator",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "totalStems",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Write functions
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "tokenURI_", type: "string" },
      { name: "royaltyReceiver", type: "address" },
      { name: "royaltyBps", type: "uint96" },
      { name: "remixable", type: "bool" },
      { name: "parentIds", type: "uint256[]" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "mintMore",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setRoyaltyReceiver",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "setRoyaltyBps",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "bps", type: "uint96" },
    ],
    outputs: [],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "safeTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  // Events
  {
    name: "StemMinted",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "parentIds", type: "uint256[]", indexed: false },
      { name: "tokenURI", type: "string", indexed: false },
    ],
  },
  {
    name: "TransferSingle",
    type: "event",
    inputs: [
      { name: "operator", type: "address", indexed: true },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "id", type: "uint256", indexed: false },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// ============ StemMarketplaceV2 ============
export const StemMarketplaceABI = [
  // Read functions
  {
    name: "getListing",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "seller", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "pricePerUnit", type: "uint256" },
          { name: "paymentToken", type: "address" },
          { name: "expiry", type: "uint40" },
        ],
      },
    ],
  },
  {
    name: "quoteBuy",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "totalPrice", type: "uint256" },
      { name: "royaltyAmount", type: "uint256" },
      { name: "protocolFee", type: "uint256" },
      { name: "sellerAmount", type: "uint256" },
    ],
  },
  {
    name: "stemNFT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "protocolFeeBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "protocolFeeRecipient",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // Write functions
  {
    name: "list",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "pricePerUnit", type: "uint256" },
      { name: "paymentToken", type: "address" },
      { name: "duration", type: "uint256" },
    ],
    outputs: [{ name: "listingId", type: "uint256" }],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "buy",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  // Events
  {
    name: "Listed",
    type: "event",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    name: "Sold",
    type: "event",
    inputs: [
      { name: "listingId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalPaid", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RoyaltyPaid",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "Cancelled",
    type: "event",
    inputs: [{ name: "listingId", type: "uint256", indexed: true }],
  },
] as const;

// ============ TransferValidator ============
export const TransferValidatorABI = [
  {
    name: "validateTransfer",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "caller", type: "address" },
      { name: "from", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "whitelist",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowDirectTransfers",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "setWhitelist",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "setWhitelistBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "accounts", type: "address[]" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "setAllowDirectTransfers",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "allowed", type: "bool" }],
    outputs: [],
  },
] as const;

// ============ Contract Addresses (per network) ============
export interface ContractAddresses {
  stemNFT: `0x${string}`;
  marketplace: `0x${string}`;
  transferValidator: `0x${string}`;
}

// Deployed addresses by chain ID
export const ADDRESSES: Record<number, ContractAddresses> = {
  // Local Anvil
  31337: {
    stemNFT: "0x0000000000000000000000000000000000000000",
    marketplace: "0x0000000000000000000000000000000000000000",
    transferValidator: "0x0000000000000000000000000000000000000000",
  },
  // Base Sepolia
  84532: {
    stemNFT: "0x0000000000000000000000000000000000000000",
    marketplace: "0x0000000000000000000000000000000000000000",
    transferValidator: "0x0000000000000000000000000000000000000000",
  },
  // Arbitrum Sepolia
  421614: {
    stemNFT: "0x0000000000000000000000000000000000000000",
    marketplace: "0x0000000000000000000000000000000000000000",
    transferValidator: "0x0000000000000000000000000000000000000000",
  },
};

// Get addresses for current chain
export function getAddresses(chainId: number): ContractAddresses {
  const addresses = ADDRESSES[chainId];
  if (!addresses) {
    throw new Error(`No contract addresses for chain ${chainId}`);
  }
  return addresses;
}
