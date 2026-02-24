"use client";

import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useMintStem } from "../../hooks/useContracts";
import { type Address } from "viem";

interface StemMintFormProps {
  stemTitle: string;
  metadataUri: string;
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

export function StemMintForm({
  stemTitle,
  metadataUri,
  onSuccess,
  onError,
}: StemMintFormProps) {
  const { address, status } = useAuth();
  const { mint, pending, error: mintError, txHash } = useMintStem();

  const [amount, setAmount] = useState("1");
  const [royaltyBps, setRoyaltyBps] = useState("500"); // 5%
  const [remixable, setRemixable] = useState(true);
  const [customRoyaltyReceiver, setCustomRoyaltyReceiver] = useState("");

  const handleMint = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!address) {
      onError?.(new Error("Wallet not connected"));
      return;
    }

    try {
      const royaltyReceiver = customRoyaltyReceiver
        ? (customRoyaltyReceiver as Address)
        : (address as Address);

      const hash = await mint({
        to: address as Address,
        amount: BigInt(amount),
        tokenURI: metadataUri,
        royaltyReceiver,
        royaltyBps: parseInt(royaltyBps),
        remixable,
        parentIds: [], // No parent stems for new mints
      });

      onSuccess?.(hash);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  if (status !== "authenticated") {
    return (
      <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800">
        <p className="text-zinc-400 text-center">Connect your wallet to mint this stem as an NFT</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleMint} className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 space-y-4">
      <h3 className="text-lg font-semibold text-white">Mint as NFT</h3>
      <p className="text-sm text-zinc-400">
        Mint &quot;{stemTitle}&quot; as an on-chain NFT with royalties
      </p>

      {/* Amount */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Number of Editions
        </label>
        <input
          type="number"
          min="1"
          max="10000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Royalty */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Royalty Percentage
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="1000"
            step="50"
            value={royaltyBps}
            onChange={(e) => setRoyaltyBps(e.target.value)}
            className="flex-1"
          />
          <span className="text-white w-16 text-right">
            {(parseInt(royaltyBps) / 100).toFixed(1)}%
          </span>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Royalty paid on secondary sales (max 10%)
        </p>
      </div>

      {/* Royalty Receiver */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Royalty Receiver (optional)
        </label>
        <input
          type="text"
          placeholder={address || "Your wallet address"}
          value={customRoyaltyReceiver}
          onChange={(e) => setCustomRoyaltyReceiver(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <p className="text-xs text-zinc-500 mt-1">
          Leave empty to receive royalties at your wallet. Use a 0xSplits address for automatic splits.
        </p>
      </div>

      {/* Remixable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-zinc-300">
            Allow Remixes
          </label>
          <p className="text-xs text-zinc-500">
            Other artists can use this stem in their remixes
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRemixable(!remixable)}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            remixable ? "bg-emerald-500" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              remixable ? "left-6" : "left-1"
            }`}
          />
        </button>
      </div>

      {/* Error Display */}
      {mintError && (
        <div className="bg-red-900/20 border border-red-800 rounded-md p-3">
          <p className="text-sm text-red-400">{mintError.message}</p>
        </div>
      )}

      {/* Success Display */}
      {txHash && (
        <div className="bg-emerald-900/20 border border-emerald-800 rounded-md p-3">
          <p className="text-sm text-emerald-400">
            Minted successfully!{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View transaction
            </a>
          </p>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={pending}
        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium py-3 rounded-md transition-colors"
      >
        {pending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Minting...
          </span>
        ) : (
          "Mint NFT"
        )}
      </button>
    </form>
  );
}
