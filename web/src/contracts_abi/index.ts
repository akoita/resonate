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
  {
    name: "lastMintedTokenIdByOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "lastMintedBlockByOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    name: "usedMintAuthorizationNonces",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "minter", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
    name: "mintAuthorized",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "tokenURI_", type: "string" },
      { name: "protectionId", type: "uint256" },
      { name: "royaltyReceiver", type: "address" },
      { name: "royaltyBps", type: "uint96" },
      { name: "remixable", type: "bool" },
      { name: "parentIds", type: "uint256[]" },
      { name: "deadline", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
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
    name: "listLastMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "pricePerUnit", type: "uint256" },
      { name: "paymentToken", type: "address" },
      { name: "duration", type: "uint256" },
      { name: "releaseId", type: "uint256" },
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

// ============ ContentProtection (Phase 2) ============
export const ContentProtectionABI = [
  {
    name: "attestRelease",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "releaseId", type: "uint256" },
      { name: "contentHash", type: "bytes32" },
      { name: "fingerprintHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "attest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "contentHash", type: "bytes32" },
      { name: "fingerprintHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "stakeForRelease",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "releaseId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "stakeForReleaseWithAsset",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "releaseId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "stake",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "refundStake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "stakeAmount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "stakeAmountsByToken",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "nextTokenId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "attestations",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "contentHash", type: "bytes32" },
      { name: "fingerprintHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "attester", type: "address" },
      { name: "timestamp", type: "uint256" },
      { name: "valid", type: "bool" },
    ],
  },
  {
    name: "stakes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "depositedAt", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "getReleaseTracks",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "releaseId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getTrackStems",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "trackId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "isAttested",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isReleaseVerified",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "releaseId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isTrackVerified",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "trackId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isStemVerified",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stemTokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isStaked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "resolveCanonicalTrack",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stemTokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "resolveProtectionTarget",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "stemToCanonicalTrack",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "stemTokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "trackToParentRelease",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "trackId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "isBlacklisted",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  // Events
  {
    name: "ContentAttested",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "contentHash", type: "bytes32", indexed: false },
      { name: "fingerprintHash", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    name: "StakeDeposited",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "staker", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "StakeRefunded",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "staker", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "TrackRegistered",
    type: "event",
    inputs: [
      { name: "releaseId", type: "uint256", indexed: true },
      { name: "trackId", type: "uint256", indexed: true },
    ],
  },
  {
    name: "StemRegistered",
    type: "event",
    inputs: [
      { name: "trackId", type: "uint256", indexed: true },
      { name: "stemTokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

export const DisputeResolutionABI = [
  {
    name: "getActiveDispute",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "DisputeFiled",
    type: "event",
    inputs: [
      { name: "disputeId", type: "uint256", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "reporter", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: false },
      { name: "evidenceURI", type: "string", indexed: false },
      { name: "counterStake", type: "uint256", indexed: false },
    ],
  },
] as const;

export const CurationRewardsABI = [
  {
    name: "reportContent",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "evidenceURI", type: "string" },
    ],
    outputs: [{ name: "disputeId", type: "uint256" }],
  },
  {
    name: "getRequiredCounterStake",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRequiredCounterStakeFor",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "curator", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "ContentReported",
    type: "event",
    inputs: [
      { name: "disputeId", type: "uint256", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "reporter", type: "address", indexed: true },
      { name: "counterStake", type: "uint256", indexed: false },
      { name: "evidenceURI", type: "string", indexed: false },
    ],
  },
] as const;

// ============ ShowCampaignEscrow ============
export const ShowCampaignEscrowABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_owner",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BPS_DENOMINATOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DEPOSIT_RELEASE_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activateCampaign",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "campaignAccounting",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "totalPledged",
        "type": "uint256"
      },
      {
        "name": "totalRefunded",
        "type": "uint256"
      },
      {
        "name": "totalReleased",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "campaignAuthority",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "authorityHash",
        "type": "bytes32"
      },
      {
        "name": "beneficiary",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "campaignStatus",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "campaigns",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "artistIdHash",
        "type": "bytes32"
      },
      {
        "name": "authorityHash",
        "type": "bytes32"
      },
      {
        "name": "beneficiary",
        "type": "address"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "goalAmount",
        "type": "uint256"
      },
      {
        "name": "minimumBackers",
        "type": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256"
      },
      {
        "name": "bookingDeadline",
        "type": "uint256"
      },
      {
        "name": "depositReleaseBps",
        "type": "uint256"
      },
      {
        "name": "disputeWindowSeconds",
        "type": "uint256"
      },
      {
        "name": "totalPledged",
        "type": "uint256"
      },
      {
        "name": "totalRefunded",
        "type": "uint256"
      },
      {
        "name": "totalReleased",
        "type": "uint256"
      },
      {
        "name": "uniqueBackers",
        "type": "uint256"
      },
      {
        "name": "fulfilledAt",
        "type": "uint256"
      },
      {
        "name": "status",
        "type": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelCampaign",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimRefund",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmBooking",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmFulfillment",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confirmers",
    "inputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createCampaign",
    "inputs": [
      {
        "name": "artistIdHash",
        "type": "bytes32"
      },
      {
        "name": "authorityHash",
        "type": "bytes32"
      },
      {
        "name": "beneficiary",
        "type": "address"
      },
      {
        "name": "paymentToken",
        "type": "address"
      },
      {
        "name": "goalAmount",
        "type": "uint256"
      },
      {
        "name": "minimumBackers",
        "type": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256"
      },
      {
        "name": "bookingDeadline",
        "type": "uint256"
      },
      {
        "name": "depositReleaseBps",
        "type": "uint256"
      },
      {
        "name": "disputeWindowSeconds",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markFailed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nextCampaignId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openRefundsAfterMissedBooking",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pledge",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "pledgedByBacker",
    "inputs": [
      {
        "name": "",
        "type": "uint256"
      },
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "refundable",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "backer",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "releasable",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "releaseDeposit",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "releaseFunds",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "renounceOwnership",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setConfirmer",
    "inputs": [
      {
        "name": "confirmer",
        "type": "address"
      },
      {
        "name": "allowed",
        "type": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPaused",
    "inputs": [
      {
        "name": "isPaused",
        "type": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "newOwner",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updateAuthority",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "authorityHash",
        "type": "bytes32"
      },
      {
        "name": "beneficiary",
        "type": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AuthorityUpdated",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "authorityHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "beneficiary",
        "type": "address",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BookingConfirmed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "confirmer",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignActivated",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignCancelled",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignCreated",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "artistIdHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "authorityHash",
        "type": "bytes32",
        "indexed": true
      },
      {
        "name": "beneficiary",
        "type": "address",
        "indexed": false
      },
      {
        "name": "paymentToken",
        "type": "address",
        "indexed": false
      },
      {
        "name": "goalAmount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "minimumBackers",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "deadline",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "bookingDeadline",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignFailed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignFunded",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "totalPledged",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "uniqueBackers",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CampaignPaused",
    "inputs": [
      {
        "name": "paused",
        "type": "bool",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ConfirmerUpdated",
    "inputs": [
      {
        "name": "confirmer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DepositReleased",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "beneficiary",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FulfillmentConfirmed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "confirmer",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FundsReleased",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "beneficiary",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Pledged",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "backer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "totalPledged",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefundAvailable",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RefundClaimed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "backer",
        "type": "address",
        "indexed": true
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BookingDeadlineNotPassed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "bookingDeadline",
        "type": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeadlineNotPassed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DepositReleaseTooHigh",
    "inputs": [
      {
        "name": "requestedBps",
        "type": "uint256"
      },
      {
        "name": "maxBps",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DepositUnavailable",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "depositReleaseBps",
        "type": "uint256"
      },
      {
        "name": "computedAmount",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DisputeWindowActive",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "unlockTime",
        "type": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "FundingThresholdAlreadyMet",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "totalPledged",
        "type": "uint256"
      },
      {
        "name": "goalAmount",
        "type": "uint256"
      },
      {
        "name": "uniqueBackers",
        "type": "uint256"
      },
      {
        "name": "minimumBackers",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAuthority",
    "inputs": [
      {
        "name": "artistIdHash",
        "type": "bytes32"
      },
      {
        "name": "authorityHash",
        "type": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidCampaign",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": [
      {
        "name": "deadline",
        "type": "uint256"
      },
      {
        "name": "bookingDeadline",
        "type": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidStatus",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "current",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoPledge",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "backer",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotConfirmer",
    "inputs": [
      {
        "name": "caller",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToRelease",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "Paused",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RefundUnavailable",
    "inputs": [
      {
        "name": "campaignId",
        "type": "uint256"
      },
      {
        "name": "current",
        "type": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;

// ============ Contract Addresses (per network) ============
export interface ContractAddresses {
  stemNFT: `0x${string}`;
  marketplace: `0x${string}`;
  transferValidator: `0x${string}`;
  contentProtection: `0x${string}`;
  disputeResolution: `0x${string}`;
  curationRewards: `0x${string}`;
  showCampaignEscrow: `0x${string}`;
}

// Deployed addresses by chain ID
export const ADDRESSES: Record<number, ContractAddresses> = {
  // Local Anvil
  31337: {
    stemNFT: (process.env.NEXT_PUBLIC_STEM_NFT_ADDRESS || "0x0165878a594ca255338adfa4d48449f69242eb8f") as `0x${string}`,
    marketplace: (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853") as `0x${string}`,
    transferValidator: (process.env.NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS || "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707") as `0x${string}`,
    contentProtection: (process.env.NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    disputeResolution: (process.env.NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    curationRewards: (process.env.NEXT_PUBLIC_CURATION_REWARDS_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    showCampaignEscrow: (process.env.NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
  },
  // Sepolia
  11155111: {
    stemNFT: (process.env.NEXT_PUBLIC_SEPOLIA_STEM_NFT_ADDRESS || process.env.NEXT_PUBLIC_STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    marketplace: (process.env.NEXT_PUBLIC_SEPOLIA_MARKETPLACE_ADDRESS || process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    transferValidator: (process.env.NEXT_PUBLIC_SEPOLIA_TRANSFER_VALIDATOR_ADDRESS || process.env.NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    contentProtection: (process.env.NEXT_PUBLIC_SEPOLIA_CONTENT_PROTECTION_ADDRESS || process.env.NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    disputeResolution: (process.env.NEXT_PUBLIC_SEPOLIA_DISPUTE_RESOLUTION_ADDRESS || process.env.NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    curationRewards: (process.env.NEXT_PUBLIC_SEPOLIA_CURATION_REWARDS_ADDRESS || process.env.NEXT_PUBLIC_CURATION_REWARDS_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    showCampaignEscrow: (process.env.NEXT_PUBLIC_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS || process.env.NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
  },
  // Base Sepolia
  84532: {
    stemNFT: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_STEM_NFT_ADDRESS || process.env.NEXT_PUBLIC_STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    marketplace: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_MARKETPLACE_ADDRESS || process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    transferValidator: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_TRANSFER_VALIDATOR_ADDRESS || process.env.NEXT_PUBLIC_TRANSFER_VALIDATOR_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    contentProtection: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_CONTENT_PROTECTION_ADDRESS || process.env.NEXT_PUBLIC_CONTENT_PROTECTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    disputeResolution: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_DISPUTE_RESOLUTION_ADDRESS || process.env.NEXT_PUBLIC_DISPUTE_RESOLUTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    curationRewards: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_CURATION_REWARDS_ADDRESS || process.env.NEXT_PUBLIC_CURATION_REWARDS_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    showCampaignEscrow: (process.env.NEXT_PUBLIC_BASE_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS || process.env.NEXT_PUBLIC_SHOW_CAMPAIGN_ESCROW_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
  },
  // Arbitrum Sepolia
  421614: {
    stemNFT: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    marketplace: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    transferValidator: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_TRANSFER_VALIDATOR_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    contentProtection: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_CONTENT_PROTECTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    disputeResolution: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_DISPUTE_RESOLUTION_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    curationRewards: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_CURATION_REWARDS_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
    showCampaignEscrow: (process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_SHOW_CAMPAIGN_ESCROW_ADDRESS || "0x0000000000000000000000000000000000000000") as `0x${string}`,
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
