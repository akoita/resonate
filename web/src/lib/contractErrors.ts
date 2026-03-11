/**
 * Pure utility functions for normalizing and formatting contract/bundler errors.
 *
 * Extracted from `useContracts.ts` and `BatchMintListModal.tsx` so they can be
 * tested without React, viem clients, or smart-account dependencies.
 */

import { decodeErrorResult, type Hex } from "viem";

// ─── ABI fragments used only for error decoding ──────────────────────

export const knownContractErrorAbi = [
  {
    type: "error",
    name: "NotAttested",
    inputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      { name: "account", type: "address" },
      { name: "neededRole", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "MarketplaceNotApproved",
    inputs: [],
  },
  {
    type: "error",
    name: "NoRecentMint",
    inputs: [],
  },
  {
    type: "error",
    name: "PriceExceedsStakeCap",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyAttested",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyStaked",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientStake",
    inputs: [],
  },
  {
    type: "error",
    name: "NotOwner",
    inputs: [],
  },
  {
    type: "error",
    name: "IsBlacklisted",
    inputs: [],
  },
  {
    type: "error",
    name: "SelfReport",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientCounterStake",
    inputs: [],
  },
  {
    type: "error",
    name: "ActiveDisputeExists",
    inputs: [],
  },
] as const;

// ─── Pure helpers ────────────────────────────────────────────────────

/** Coerce anything into an Error. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Extract the first hex-encoded revert data from a bundler/RPC error message.
 * Returns `null` if no match is found.
 */
export function extractRevertData(message: string): Hex | null {
  const patterns = [
    /simulation with reason:\s*(0x[a-fA-F0-9]+)/i,
    /reverted with reason:\s*(0x[a-fA-F0-9]+)/i,
    /execution reverted with reason:\s*(0x[a-fA-F0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1] as Hex;
    }
  }

  return null;
}

/**
 * Turn a raw contract-write / bundler error into a user-friendly Error.
 *
 * 1. Strip the verbose " Request Arguments: …" suffix.
 * 2. Try to decode known custom errors (NotAttested, AccessControl, etc.).
 * 3. Fall back to the trimmed message.
 */
export function normalizeContractWriteError(error: unknown): Error {
  const baseError = toError(error);
  const trimmedMessage = baseError.message.split(" Request Arguments:")[0].trim();
  const revertData = extractRevertData(trimmedMessage);

  if (revertData) {
    try {
      const decoded = decodeErrorResult({
        abi: knownContractErrorAbi,
        data: revertData,
      });

      if (decoded.errorName === "NotAttested") {
        const tokenId = decoded.args?.[0];
        return new Error(
          `Content Protection blocked this action because release protection record #${tokenId?.toString() || "?"} has not been attested on-chain yet.`
        );
      }

      if (decoded.errorName === "AccessControlUnauthorizedAccount") {
        return new Error("This wallet is missing the StemNFT minter role on the current chain.");
      }

      if (decoded.errorName === "MarketplaceNotApproved") {
        return new Error("Marketplace approval is missing for this Stem NFT.");
      }

      if (decoded.errorName === "NoRecentMint") {
        return new Error("The marketplace could not find a stem minted in this transaction. Please retry the mint and list flow.");
      }

      if (decoded.errorName === "PriceExceedsStakeCap") {
        return new Error("Listing price exceeds the maximum allowed by the current Content Protection stake for this release.");
      }

      if (decoded.errorName === "AlreadyAttested") {
        return new Error("This release has already been attested on-chain.");
      }

      if (decoded.errorName === "AlreadyStaked") {
        return new Error("Stake has already been deposited for this release.");
      }

      if (decoded.errorName === "InsufficientStake") {
        return new Error("The stake amount sent is below the current Content Protection requirement.");
      }

      if (decoded.errorName === "NotOwner") {
        return new Error("The connected smart account does not own this Content Protection record.");
      }

      if (decoded.errorName === "IsBlacklisted") {
        return new Error("This wallet is blacklisted from Content Protection actions on the current chain.");
      }

      if (decoded.errorName === "SelfReport") {
        return new Error("You cannot report content that was published by your own smart account.");
      }

      if (decoded.errorName === "InsufficientCounterStake") {
        return new Error("The report counter-stake sent is below the current requirement.");
      }

      if (decoded.errorName === "ActiveDisputeExists") {
        return new Error("An active dispute already exists for this content record.");
      }
    } catch {
      // Fall back to the trimmed bundler error below.
    }
  }

  return new Error(trimmedMessage || "Transaction failed");
}

/**
 * Format a batch-mint error message for the modal UI.
 * Strips bundler request args and caps at 280 characters.
 */
export function formatBatchErrorMessage(message: string): string {
  const trimmed = message.split(" Request Arguments:")[0].trim();
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed;
}
