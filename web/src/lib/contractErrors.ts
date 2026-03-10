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
          `Content Protection blocked minting for token #${tokenId?.toString() || "?"}. This chain requires that exact stem token ID to be attested on-chain before minting.`
        );
      }

      if (decoded.errorName === "AccessControlUnauthorizedAccount") {
        return new Error("This wallet is missing the StemNFT minter role on the current chain.");
      }

      if (decoded.errorName === "MarketplaceNotApproved") {
        return new Error("Marketplace approval is missing for this Stem NFT.");
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
