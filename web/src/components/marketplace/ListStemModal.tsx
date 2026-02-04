"use client";

import { useState } from "react";
import { useListStem, useStemBalance } from "../../hooks/useContracts";
import { parsePrice } from "../../lib/contracts";
import { type Address } from "viem";

interface ListStemModalProps {
  tokenId: bigint;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (txHash: string) => void;
}

export function ListStemModal({ tokenId, isOpen, onClose, onSuccess }: ListStemModalProps) {
  const { balance } = useStemBalance(tokenId);
  const { list, pending, error, txHash } = useListStem();

  const [price, setPrice] = useState("0.01");
  const [amount, setAmount] = useState("1");
  const [duration, setDuration] = useState("7"); // Days

  if (!isOpen) return null;

  const handleList = async () => {
    try {
      const hash = await list({
        tokenId,
        amount: BigInt(amount),
        pricePerUnit: parsePrice(price),
        paymentToken: "0x0000000000000000000000000000000000000000" as Address, // ETH
        durationSeconds: BigInt(parseInt(duration) * 24 * 60 * 60),
      });
      onSuccess?.(hash);
    } catch (err) {
      // Error handled by hook
    }
  };

  const maxAmount = balance;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-zinc-900 rounded-lg border border-zinc-800 w-full max-w-md mx-4 p-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-xl font-semibold text-white mb-4">List Stem for Sale</h2>

        <div className="space-y-4">
          {/* Token Info */}
          <div className="bg-zinc-800 rounded-lg p-4">
            <p className="text-sm text-zinc-400">Token ID</p>
            <p className="text-white font-mono">{tokenId.toString()}</p>
            <p className="text-sm text-zinc-400 mt-2">Your Balance</p>
            <p className="text-white">{balance.toString()} editions</p>
          </div>

          {/* Price Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Price per Edition (ETH)
            </label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
            />
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Quantity to List (max: {maxAmount.toString()})
            </label>
            <input
              type="number"
              min="1"
              max={maxAmount.toString()}
              value={amount}
              onChange={(e) => {
                const val = parseInt(e.target.value || "1");
                const max = Number(maxAmount);
                setAmount(Math.min(Math.max(val, 1), max).toString());
              }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
            />
          </div>

          {/* Duration Select */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Listing Duration
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white"
            >
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>

          {/* Summary */}
          <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Total Value</span>
              <span className="text-white">
                {(parseFloat(price) * parseInt(amount || "1")).toFixed(4)} ETH
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">Expires</span>
              <span className="text-white">
                {new Date(
                  Date.now() + parseInt(duration) * 24 * 60 * 60 * 1000
                ).toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Info */}
          <p className="text-xs text-zinc-500">
            You will need to approve the marketplace to transfer your NFTs. 
            Royalties and protocol fees are automatically deducted from sales.
          </p>

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-md p-3">
              <p className="text-sm text-red-400">{error.message}</p>
            </div>
          )}

          {/* Success */}
          {txHash && (
            <div className="bg-emerald-900/20 border border-emerald-800 rounded-md p-3">
              <p className="text-sm text-emerald-400">
                Listed successfully!{" "}
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

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleList}
              disabled={pending || maxAmount === 0n || !price || parseFloat(price) <= 0}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white py-3 rounded-md transition-colors"
            >
              {pending ? "Listing..." : "List for Sale"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
