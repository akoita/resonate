"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { type Address, encodeFunctionData, type Hex, http, type PublicClient } from "viem";
import { useZeroDev } from "../components/auth/ZeroDevProviderClient";
import { useAuth } from "../components/auth/AuthProvider";
import {
  getStemData,
  getTokenURI,
  getBalance,
  getRoyaltyInfo,
  getParentIds,
  isRemix,
  getTotalStems,
  getListing,
  quoteBuy,
  getProtocolFeeBps,
  getContractAddresses,
  type StemData,
  type Listing,
  type BuyQuote,
  type MintParams,
  type ListParams,
  StemNFTABI,
  StemMarketplaceABI,
} from "../lib/contracts";

// Helper to send transaction via ZeroDev kernel client or local wallet
async function sendContractTransaction(
  publicClient: PublicClient,
  chainId: number,
  to: Address,
  data: Hex,
  value: bigint = BigInt(0),
  userAddress?: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelAccount?: any
): Promise<string> {
  // Detect local development: either Anvil (31337) or forked Sepolia with local RPC
  const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL || "";
  const isLocalRpc = rpcOverride.includes("localhost") || rpcOverride.includes("127.0.0.1");
  const isLocalDev = chainId === 31337 || isLocalRpc;

  if (isLocalDev) {
    const { sendLocalTransaction } = await import("../lib/localAA");

    // Use user's address if provided, otherwise fall back to a test address
    const effectiveAddress = userAddress || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

    // Send transaction using user's deterministic local account
    // This auto-funds from Anvil if needed
    const hash = await sendLocalTransaction(publicClient, effectiveAddress, to, data, value);

    return hash;
  }

  // For testnet/mainnet, use ZeroDev
  const projectId = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID;
  if (!projectId) {
    throw new Error("Transaction sending requires ZeroDev configuration. Set NEXT_PUBLIC_ZERODEV_PROJECT_ID for testnet.");
  }

  // Import ZeroDev SDK dynamically
  const sdk = await import("@zerodev/sdk");
  const { createKernelAccountClient, constants } = sdk;

  // Use the pre-authenticated kernel account from auth context.
  // This avoids creating a duplicate passkey validator which could pick up
  // a stale passkey registered on a different domain (e.g. localhost).
  let account = kernelAccount;

  if (!account) {
    // Fallback: create a new passkey validator (requires user interaction)
    const passkey = await import("@zerodev/passkey-validator");
    const { toPasskeyValidator, toWebAuthnKey, PasskeyValidatorContractVersion } = passkey;

    const entryPoint = constants.getEntryPoint("0.7");
    const kernelVersion = constants.KERNEL_V3_1;

    const webAuthnKey = await toWebAuthnKey({
      passkeyName: "Resonate",
      passkeyServerUrl: process.env.NEXT_PUBLIC_PASSKEY_SERVER_URL || `https://passkeys.zerodev.app/api/v3/${projectId}`,
      mode: passkey.WebAuthnMode.Login,
      rpID: typeof window !== "undefined" ? window.location.hostname : undefined,
    });

    const passkeyValidator = await toPasskeyValidator(publicClient, {
      webAuthnKey,
      entryPoint,
      kernelVersion,
      validatorContractVersion: PasskeyValidatorContractVersion.V0_0_1_UNPATCHED,
    });

    account = await sdk.createKernelAccount(publicClient, {
      plugins: { sudo: passkeyValidator },
      entryPoint,
      kernelVersion,
    });
  }

  // Use Pimlico bundler (self-funded, no paymaster).
  // ZeroDev's bundler rejects passkey-based accounts with "Unauthorized: wapk".
  const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY || "REDACTED_PIMLICO_KEY";
  const bundlerUrl = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${pimlicoApiKey}`;

  // Custom transport that maps ZeroDev-proprietary methods to Pimlico equivalents.
  // ZeroDev SDK calls "zd_getUserOperationGasPrice" which Pimlico doesn't support,
  // but Pimlico has "pimlico_getUserOperationGasPrice" with the same response format.
  const pimlicoTransport = http(bundlerUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappedTransport = (opts: any) => {
    const transport = pimlicoTransport(opts);
    const originalRequest = transport.request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.request = async (args: any) => {
      const mappedArgs = { ...args };
      if (args.method === "zd_getUserOperationGasPrice") {
        mappedArgs.method = "pimlico_getUserOperationGasPrice";
      }
      return originalRequest(mappedArgs);
    };
    return transport;
  };

  const kernelClient = await createKernelAccountClient({
    account,
    chain: publicClient.chain,
    bundlerTransport: mappedTransport,
  });

  // Send transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await (kernelClient as any).sendTransaction({
    to,
    data,
    value,
    chain: publicClient.chain,
  });

  console.log("[ZeroDev] Transaction submitted! Hash:", hash);
  return hash;
}

// ============ StemNFT Hooks ============

/**
 * Hook to read stem data from the StemNFT contract
 */
export function useStemData(tokenId: bigint | undefined) {
  const { publicClient, chainId } = useZeroDev();
  const [data, setData] = useState<StemData | null>(null);
  const [loading, setLoading] = useState(tokenId !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tokenId === undefined) return;

    const fetchData = async () => {
      try {
        const result = await getStemData(publicClient, chainId, tokenId);
        if (mountedRef.current) {
          setData(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchData();
  }, [publicClient, chainId, tokenId]);

  // Return null data when tokenId is undefined
  const currentData = tokenId === undefined ? null : data;
  return { data: currentData, loading, error };
}

/**
 * Hook to get token URI
 */
export function useTokenURI(tokenId: bigint | undefined) {
  const { publicClient, chainId } = useZeroDev();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(tokenId !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tokenId === undefined) return;

    const fetchUri = async () => {
      try {
        const result = await getTokenURI(publicClient, chainId, tokenId);
        if (mountedRef.current) {
          setUri(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchUri();
  }, [publicClient, chainId, tokenId]);

  const currentUri = tokenId === undefined ? null : uri;
  return { uri: currentUri, loading, error };
}

/**
 * Hook to get user's balance of a token
 */
export function useStemBalance(tokenId: bigint | undefined, account?: Address) {
  const { publicClient, chainId } = useZeroDev();
  const { address: authAddress } = useAuth();
  const targetAccount = account || (authAddress as Address | undefined);

  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (tokenId === undefined || !targetAccount) return;

    let cancelled = false;
    setLoading(true);

    const fetchBalance = async () => {
      try {
        let resolvedAccount = targetAccount;
        const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL || "";
            const isLocalRpc = rpcOverride.includes("localhost") || rpcOverride.includes("127.0.0.1");
            const isLocalOrFork = chainId === 31337 || isLocalRpc;
        if (isLocalOrFork && !account) {
          const { getLocalSignerAddress } = await import("../lib/localAA");
          resolvedAccount = getLocalSignerAddress(targetAccount);
        }

        const result = await getBalance(publicClient, chainId, resolvedAccount, tokenId);
        if (!cancelled) setBalance(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchBalance();

    return () => {
      cancelled = true;
    };
  }, [publicClient, chainId, tokenId, targetAccount, account]);

  return { balance, loading, error };
}

/**
 * Hook to get royalty info for a token
 */
export function useRoyaltyInfo(tokenId: bigint | undefined, salePrice: bigint) {
  const { publicClient, chainId } = useZeroDev();
  const [royalty, setRoyalty] = useState<{ receiver: Address; amount: bigint } | null>(null);
  const [loading, setLoading] = useState(tokenId !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tokenId === undefined) return;

    const fetchRoyalty = async () => {
      try {
        const result = await getRoyaltyInfo(publicClient, chainId, tokenId, salePrice);
        if (mountedRef.current) {
          setRoyalty(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchRoyalty();
  }, [publicClient, chainId, tokenId, salePrice]);

  const currentRoyalty = tokenId === undefined ? null : royalty;
  return { royalty: currentRoyalty, loading, error };
}

/**
 * Hook to get parent stem IDs (for remixes)
 */
export function useParentStems(tokenId: bigint | undefined) {
  const { publicClient, chainId } = useZeroDev();
  const [parentIds, setParentIds] = useState<readonly bigint[]>([]);
  const [isRemixResult, setIsRemix] = useState(false);
  const [loading, setLoading] = useState(tokenId !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tokenId === undefined) return;

    const fetchData = async () => {
      try {
        const [parents, remix] = await Promise.all([
          getParentIds(publicClient, chainId, tokenId),
          isRemix(publicClient, chainId, tokenId),
        ]);
        if (mountedRef.current) {
          setParentIds(parents);
          setIsRemix(remix);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchData();
  }, [publicClient, chainId, tokenId]);

  const currentParentIds = tokenId === undefined ? [] : parentIds;
  const currentIsRemix = tokenId === undefined ? false : isRemixResult;
  return { parentIds: currentParentIds, isRemix: currentIsRemix, loading, error };
}

/**
 * Hook to get total number of stems minted
 */
export function useTotalStems() {
  const { publicClient, chainId } = useZeroDev();
  const [total, setTotal] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const result = await getTotalStems(publicClient, chainId);
      if (mountedRef.current) {
        setTotal(result);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  }, [publicClient, chainId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { total, loading, error, refresh };
}

// ============ Marketplace Hooks ============

/**
 * Hook to read a listing
 */
export function useListing(listingId: bigint | undefined) {
  const { publicClient, chainId } = useZeroDev();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(listingId !== undefined);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (listingId === undefined) return;

    const fetchListing = async () => {
      try {
        const result = await getListing(publicClient, chainId, listingId);
        if (mountedRef.current) {
          setListing(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchListing();
  }, [publicClient, chainId, listingId]);

  const currentListing = listingId === undefined ? null : listing;
  return { listing: currentListing, loading, error };
}

/**
 * Hook to quote a buy order
 */
export function useBuyQuote(listingId: bigint | undefined, amount: bigint) {
  const { publicClient, chainId } = useZeroDev();
  const [quote, setQuote] = useState<BuyQuote | null>(null);
  const [loading, setLoading] = useState(listingId !== undefined && amount !== 0n);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (listingId === undefined || amount === 0n) return;

    const fetchQuote = async () => {
      try {
        const result = await quoteBuy(publicClient, chainId, listingId, amount);
        if (mountedRef.current) {
          setQuote(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchQuote();
  }, [publicClient, chainId, listingId, amount]);

  const currentQuote = (listingId === undefined || amount === 0n) ? null : quote;
  return { quote: currentQuote, loading, error };
}

/**
 * Hook to get protocol fee
 */
export function useProtocolFee() {
  const { publicClient, chainId } = useZeroDev();
  const [feeBps, setFeeBps] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const fetchFee = async () => {
      try {
        const result = await getProtocolFeeBps(publicClient, chainId);
        if (mountedRef.current) {
          setFeeBps(result);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchFee();
  }, [publicClient, chainId]);

  return { feeBps, loading, error };
}

// ============ Contract Addresses Hook ============

/**
 * Hook to get contract addresses for current chain
 */
export function useContractAddresses() {
  const { chainId } = useZeroDev();

  const addresses = useMemo(() => {
    try {
      return getContractAddresses(chainId);
    } catch {
      return null;
    }
  }, [chainId]);

  return { addresses, chainId };
}

// ============ Write Hooks (using smart account) ============

/**
 * Hook to mint a new stem
 */
export function useMintStem() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const mint = useCallback(
    async (params: MintParams) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const addresses = getContractAddresses(chainId);

        // Encode the function call
        const data = encodeFunctionData({
          abi: StemNFTABI,
          functionName: "mint",
          args: [
            params.to,
            params.amount,
            params.tokenURI,
            params.royaltyReceiver,
            BigInt(params.royaltyBps),
            params.remixable,
            params.parentIds,
          ],
        });

        // Send transaction via ZeroDev kernel client
        const hash = await sendContractTransaction(
          publicClient,
          chainId,
          addresses.stemNFT,
          data,
          BigInt(0),
          address as Address,
          kernelAccount
        );

        setTxHash(hash);
        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, chainId, kernelAccount]
  );

  return { mint, pending, error, txHash };
}

// Helper to send batch transactions via ZeroDev kernel client
async function sendBatchContractTransactions(
  publicClient: PublicClient,
  chainId: number,
  calls: { to: Address; data: Hex; value?: bigint }[],
  userAddress?: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelAccount?: any
): Promise<string> {
  const isLocalDev = chainId === 31337;
  if (isLocalDev) {
    throw new Error("Batch transactions not implemented for local development wrapper");
  }

  const projectId = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID;
  if (!projectId) {
    throw new Error("Transaction sending requires ZeroDev configuration. Set NEXT_PUBLIC_ZERODEV_PROJECT_ID for testnet.");
  }

  // Import ZeroDev SDK dynamically
  const sdk = await import("@zerodev/sdk");
  const { createKernelAccountClient, constants } = sdk;

  let account = kernelAccount;

  if (!account) {
    // Fallback: create a new passkey validator (requires user interaction)
    const passkey = await import("@zerodev/passkey-validator");
    const { toPasskeyValidator, toWebAuthnKey, PasskeyValidatorContractVersion } = passkey;

    const entryPoint = constants.getEntryPoint("0.7");
    const kernelVersion = constants.KERNEL_V3_1;

    const webAuthnKey = await toWebAuthnKey({
      passkeyName: "Resonate",
      passkeyServerUrl: process.env.NEXT_PUBLIC_PASSKEY_SERVER_URL || `https://passkeys.zerodev.app/api/v3/${projectId}`,
      mode: passkey.WebAuthnMode.Login,
      rpID: typeof window !== "undefined" ? window.location.hostname : undefined,
    });

    const passkeyValidator = await toPasskeyValidator(publicClient, {
      webAuthnKey,
      entryPoint,
      kernelVersion,
      validatorContractVersion: PasskeyValidatorContractVersion.V0_0_1_UNPATCHED,
    });

    account = await sdk.createKernelAccount(publicClient, {
      plugins: { sudo: passkeyValidator },
      entryPoint,
      kernelVersion,
    });
  }

  const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY || "REDACTED_PIMLICO_KEY";
  const bundlerUrl = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${pimlicoApiKey}`;
  const pimlicoTransport = http(bundlerUrl);
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappedTransport = (opts: any) => {
    const transport = pimlicoTransport(opts);
    const originalRequest = transport.request;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.request = async (args: any) => {
      const mappedArgs = { ...args };
      if (args.method === "zd_getUserOperationGasPrice") {
        mappedArgs.method = "pimlico_getUserOperationGasPrice";
      }
      return originalRequest(mappedArgs);
    };
    return transport;
  };

  const kernelClient = await createKernelAccountClient({
    account,
    chain: publicClient.chain,
    bundlerTransport: mappedTransport,
  });

  // Send batch as a single UserOperation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userOpHash = await (kernelClient as any).sendUserOperation({
    calls: calls.map(c => ({
      to: c.to,
      data: c.data,
      value: c.value || BigInt(0),
    })),
  });

  // Wait for the bundler to mine the UserOperation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receipt = await (kernelClient as unknown as any).waitForUserOperationReceipt({
    hash: userOpHash,
  });

  const hash = receipt.receipt.transactionHash;
  console.log("[ZeroDev] Batch Transaction submitted! Hash:", hash);
  return hash;
}

// ... existing code ...

/**
 * Hook to list a stem on the marketplace
 */
export function useListStem() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const list = useCallback(
    async (params: ListParams) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const addresses = getContractAddresses(chainId);

        // First, approve marketplace to transfer NFTs
        const approveData = encodeFunctionData({
          abi: StemNFTABI,
          functionName: "setApprovalForAll",
          args: [addresses.marketplace, true],
        });

        // Then create listing
        const listData = encodeFunctionData({
          abi: StemMarketplaceABI,
          functionName: "list",
          args: [
            params.tokenId,
            params.amount,
            params.pricePerUnit,
            params.paymentToken,
            params.durationSeconds,
          ],
        });

        // Batch both approval and listing into a single UserOperation
        const hash = await sendBatchContractTransactions(
          publicClient,
          chainId,
          [
            { to: addresses.stemNFT, data: approveData },
            { to: addresses.marketplace, data: listData }
          ],
          address as Address,
          kernelAccount
        );

        setTxHash(hash);
        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, chainId, kernelAccount]
  );

  return { list, pending, error, txHash };
}

/**
 * Hook to buy a stem from the marketplace
 */
export function useBuyStem() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const buy = useCallback(
    async (listingId: bigint, amount: bigint) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const addresses = getContractAddresses(chainId);

        // Get quote to know how much to send
        const quote = await quoteBuy(publicClient, chainId, listingId, amount);

        // Execute buy
        const data = encodeFunctionData({
          abi: StemMarketplaceABI,
          functionName: "buy",
          args: [listingId, amount],
        });

        const hash = await sendContractTransaction(
          publicClient,
          chainId,
          addresses.marketplace,
          data,
          quote.totalPrice,
          address as Address,
          kernelAccount
        );

        setTxHash(hash);
        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, chainId, kernelAccount]
  );

  return { buy, pending, error, txHash };
}

/**
 * Hook to cancel a listing
 */
export function useCancelListing() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const cancel = useCallback(
    async (listingId: bigint) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const addresses = getContractAddresses(chainId);

        const data = encodeFunctionData({
          abi: StemMarketplaceABI,
          functionName: "cancel",
          args: [listingId],
        });

        const hash = await sendContractTransaction(
          publicClient,
          chainId,
          addresses.marketplace,
          data,
          BigInt(0),
          address as Address,
          kernelAccount
        );

        setTxHash(hash);
        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, chainId, kernelAccount]
  );

  return { cancel, pending, error, txHash };
}
