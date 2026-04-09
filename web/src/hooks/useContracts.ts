"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { decodeEventLog, type Address, encodeFunctionData, type Hex, http, type PublicClient } from "viem";
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
import {
  createBatchStemMintAuthorizations,
  createStemMintAuthorization,
  type StemMintAuthorization,
} from "../lib/api";
import { CurationRewardsABI, DisputeResolutionABI } from "../contracts_abi/index";
import { normalizeContractWriteError } from "../lib/contractErrors";
import { getKernelAccountConfig } from "../lib/accountAbstraction";
import { persistStemMarketplaceStatus } from "../lib/stemMarketplaceStatus";

// Detect whether we're running against a local RPC (Anvil / forked Sepolia)
function isLocalDevEnvironment(chainId?: number): boolean {
  if (chainId === 31337) return true;
  const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL || "";
  return rpcOverride.includes("localhost") || rpcOverride.includes("127.0.0.1");
}

// Get the bundler URL — local Alto (via /api/bundler proxy) or Pimlico cloud
function getBundlerUrl(chainId: number): string {
  const override = process.env.NEXT_PUBLIC_AA_BUNDLER;
  if (override) return override;
  if (isLocalDevEnvironment(chainId)) return "/api/bundler";
  const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY || "";
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${pimlicoApiKey}`;
}

// Custom transport that maps ZeroDev-proprietary methods to Pimlico/Alto equivalents
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMappedTransport(bundlerUrl: string): (opts: any) => any {
  const baseTransport = http(bundlerUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (opts: any) => {
    const transport = baseTransport(opts);
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
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

type StemMintedTransactionEvent = {
  tokenId: bigint;
  tokenURI: string;
};

async function getStemMintedEventsForTransaction(
  publicClient: PublicClient,
  transactionHash: string
): Promise<StemMintedTransactionEvent[]> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: transactionHash as Hex,
  });

  const mintedEvents: StemMintedTransactionEvent[] = [];

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: StemNFTABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "StemMinted") {
        mintedEvents.push({
          tokenId: decoded.args.tokenId as bigint,
          tokenURI: decoded.args.tokenURI as string,
        });
      }
    } catch {
      // Ignore logs from other contracts/events in the same receipt.
    }
  }

  return mintedEvents;
}

async function getReportedDisputeForTransaction(
  publicClient: PublicClient,
  transactionHash: string
): Promise<{
  disputeId?: bigint;
  tokenId?: bigint;
  counterStake?: bigint;
}> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: transactionHash as Hex,
  });

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: CurationRewardsABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "ContentReported") {
        return {
          disputeId: decoded.args.disputeId as bigint,
          tokenId: decoded.args.tokenId as bigint,
          counterStake: decoded.args.counterStake as bigint,
        };
      }
    } catch {
      // Ignore logs from other contracts/events in the same receipt.
    }

    try {
      const decoded = decodeEventLog({
        abi: DisputeResolutionABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === "DisputeFiled") {
        return {
          disputeId: decoded.args.disputeId as bigint,
          tokenId: decoded.args.tokenId as bigint,
          counterStake: decoded.args.counterStake as bigint,
        };
      }
    } catch {
      // Ignore logs from other contracts/events in the same receipt.
    }
  }

  return {};
}

function toAuthorizedMintParams(
  authorization: StemMintAuthorization
): NonNullable<MintParams["authorization"]> {
  return {
    tokenURI: authorization.tokenURI,
    to: authorization.authorization.to as Address,
    amount: BigInt(authorization.authorization.amount),
    protectionId: BigInt(authorization.authorization.protectionId),
    royaltyReceiver: authorization.authorization.royaltyReceiver as Address,
    royaltyBps: authorization.authorization.royaltyBps,
    remixable: authorization.authorization.remixable,
    parentIds: authorization.authorization.parentIds.map((id) => BigInt(id)),
    deadline: BigInt(authorization.authorization.deadline),
    nonce: authorization.authorization.nonce,
    signature: authorization.signature,
  };
}

async function assertMintAuthorizationSupported(
  publicClient: PublicClient,
  stemNftAddress: Address,
  callerAddress: Address
): Promise<void> {
  try {
    await publicClient.readContract({
      address: stemNftAddress,
      abi: StemNFTABI,
      functionName: "usedMintAuthorizationNonces",
      args: [
        callerAddress,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
    });
  } catch {
    throw new Error(
      "The current StemNFT deployment does not support mintAuthorized(). Redeploy protocol contracts and run ./contracts/scripts/update-protocol-config.sh, then restart the frontend."
    );
  }
}

async function resolveMintAuthorization(
  token: string | null,
  chainId: number,
  callerAddress: Address,
  params: MintParams
): Promise<NonNullable<MintParams["authorization"]> | undefined> {
  if (params.authorization) {
    return params.authorization;
  }
  if (!params.stemId) {
    return undefined;
  }
  if (!token) {
    throw new Error("Not authenticated");
  }

  const authorization = await createStemMintAuthorization(token, {
    stemId: params.stemId,
    chainId,
    minterAddress: callerAddress,
    to: (params.to || callerAddress) as string,
    amount: params.amount.toString(),
    royaltyReceiver: (params.royaltyReceiver || callerAddress) as string,
    royaltyBps: params.royaltyBps,
    remixable: params.remixable,
    parentIds: params.parentIds.map((id) => id.toString()),
  });

  return toAuthorizedMintParams(authorization);
}

/**
 * Auto-fund a smart account from Anvil when running locally.
 */
async function ensureLocalFunding(
  publicClient: PublicClient,
  smartAccountAddress: Address,
  value: bigint
): Promise<void> {
  if (!isLocalDevEnvironment(publicClient.chain?.id)) return;
  const balance = await publicClient.getBalance({ address: smartAccountAddress });
  const needed = value + BigInt("500000000000000000");
  if (balance >= needed) return;
  console.log(`[AA] Funding smart account ${smartAccountAddress} from Anvil...`);
  const { fundSmartAccount } = await import("../lib/localFunding");
  await fundSmartAccount(publicClient, smartAccountAddress, needed - balance + BigInt("1000000000000000000"));
}

/**
 * Send a transaction via the authenticated Kernel smart account.
 * Uses the same code path for both local dev and production:
 * - Local: passkey-signed UserOp → local Alto bundler (no paymaster)
 * - Production: passkey-signed UserOp → Pimlico bundler + paymaster
 */
async function sendContractTransaction(
  publicClient: PublicClient,
  chainId: number,
  to: Address,
  data: Hex | ((addr: Address) => Hex),
  value: bigint = BigInt(0),
  userAddress?: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelAccount?: any
): Promise<string> {
  const sdk = await import("@zerodev/sdk");
  const { createKernelAccountClient, constants } = sdk;

  let account = kernelAccount;

  if (!account) {
    // Fallback: create a new passkey validator (requires user interaction)
    const projectId = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID;
    const passkey = await import("@zerodev/passkey-validator");
    const { toPasskeyValidator, toWebAuthnKey, PasskeyValidatorContractVersion } = passkey;

    const { entryPoint, factoryAddress } = getKernelAccountConfig(chainId);
    const kernelVersion = constants.KERNEL_V3_1;

    const passkeyServerUrl = projectId
      ? `/api/zerodev/${projectId}`
      : `/api/zerodev/self-hosted`;

    const webAuthnKey = await toWebAuthnKey({
      passkeyName: "Resonate",
      passkeyServerUrl,
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
      factoryAddress,
    });
  }

  // Auto-fund on local dev (Anvil has pre-funded accounts)
  await ensureLocalFunding(publicClient, account.address as Address, value);

  const bundlerUrl = getBundlerUrl(chainId);
  const mappedTransport = createMappedTransport(bundlerUrl);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientOpts: any = {
    account,
    chain: publicClient.chain,
    bundlerTransport: mappedTransport,
  };

  // Only use paymaster on non-local environments (local dev is self-funded)
  if (!isLocalDevEnvironment(chainId)) {
    const { createZeroDevPaymasterClient } = await import("@zerodev/sdk");
    clientOpts.paymaster = createZeroDevPaymasterClient({
      chain: publicClient.chain,
      transport: http(bundlerUrl),
    });
  }

  const kernelClient = await createKernelAccountClient(clientOpts);
  const finalData = typeof data === 'function' ? data(account.address as Address) : data;

  let hash: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hash = await (kernelClient as any).sendTransaction({
      to,
      data: finalData,
      value,
      chain: publicClient.chain,
    });
  } catch (error) {
    throw normalizeContractWriteError(error);
  }

  console.log("[AA] Transaction submitted! Hash:", hash);
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
  const { address: authAddress, smartAccountAddress } = useAuth();
  // Use the smart account address (on-chain identity) for balance queries
  const targetAccount = account || (smartAccountAddress as Address | undefined) || (authAddress as Address | undefined);

  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (tokenId === undefined || !targetAccount) return;

    let cancelled = false;
    setLoading(true);

    const fetchBalance = async () => {
      try {
        const result = await getBalance(publicClient, chainId, targetAccount, tokenId);
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
  const { address, status, token, kernelAccount, smartAccountAddress } = useAuth();
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
        const callerAddress =
          (kernelAccount?.address as Address | undefined) ||
          (smartAccountAddress as Address | undefined) ||
          (address as Address);
        const authorization = await resolveMintAuthorization(
          token,
          chainId,
          callerAddress,
          params
        );
        if (authorization) {
          await assertMintAuthorizationSupported(
            publicClient,
            addresses.stemNFT as Address,
            callerAddress
          );
        }

        const tokenURI = authorization?.tokenURI || params.tokenURI;
        const to = authorization?.to || params.to || callerAddress;
        const amount = authorization?.amount || params.amount;
        const royaltyReceiver =
          authorization?.royaltyReceiver ||
          params.royaltyReceiver ||
          callerAddress;
        const royaltyBps = authorization?.royaltyBps ?? params.royaltyBps;
        const remixable = authorization?.remixable ?? params.remixable;
        const parentIds = authorization?.parentIds || params.parentIds;

        if (!tokenURI) {
          throw new Error("tokenURI is required when no mint authorization is provided");
        }

        // Send transaction via ZeroDev kernel client
        const hash = await sendContractTransaction(
          publicClient,
          chainId,
          addresses.stemNFT,
          (resolvedAddress: Address) => encodeFunctionData({
            abi: StemNFTABI,
            functionName: authorization ? "mintAuthorized" : "mint",
            args: authorization
              ? [
                to,
                amount,
                tokenURI,
                authorization.protectionId,
                royaltyReceiver,
                BigInt(royaltyBps),
                remixable,
                parentIds,
                authorization.deadline,
                authorization.nonce,
                authorization.signature,
              ]
              : [
                to || resolvedAddress,
                amount,
                tokenURI,
                royaltyReceiver || resolvedAddress,
                BigInt(royaltyBps),
                remixable,
                parentIds,
              ],
          }),
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
    [publicClient, address, status, token, chainId, kernelAccount, smartAccountAddress]
  );

  return { mint, pending, error, txHash };
}

/**
 * Hook to attest and stake a release root for content protection in a single atomic batch UserOp.
 *
 * Flow: attestRelease(releaseId, contentHash, fingerprintHash, metadataURI)
 *    + stakeForRelease(releaseId)
 * Both calls are sent as one batch UserOp — if either fails, nothing happens.
 */
export function useAttestAndStake() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount, smartAccountAddress } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const attestAndStake = useCallback(
    async (params: {
      contentHash: Hex;         // keccak256 of the audio file(s)
      fingerprintHash: Hex;     // keccak256 of a client-side fingerprint (or placeholder)
      metadataURI: string;      // Release metadata URI (e.g., IPFS or API endpoint)
      stakeAmountWei: bigint;   // Amount to stake (from trust tier)
    }) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const { getAddresses, ContentProtectionABI } = await import("../contracts_abi/index");
        const addresses = getAddresses(chainId);

        if (addresses.contentProtection === "0x0000000000000000000000000000000000000000") {
          throw new Error("ContentProtection contract not deployed on this chain");
        }

        const cpAddress = addresses.contentProtection as Address;
        const callerAddress =
          (kernelAccount?.address as Address | undefined) ||
          (smartAccountAddress as Address | undefined) ||
          (address as Address);

        // Generate a deterministic release protection id from address + contentHash.
        // This remains the canonical release root that tracks and stems inherit from.
        const { keccak256: viemKeccak256, encodePacked } = await import("viem");
        const releaseId = BigInt(
          viemKeccak256(encodePacked(["address", "bytes32"], [callerAddress, params.contentHash]))
        );

        const [attestation, stakeInfo] = await Promise.all([
          publicClient.readContract({
            address: cpAddress,
            abi: ContentProtectionABI,
            functionName: "attestations",
            args: [releaseId],
          }),
          publicClient.readContract({
            address: cpAddress,
            abi: ContentProtectionABI,
            functionName: "stakes",
            args: [releaseId],
          }),
        ]);

        const existingAttester = attestation[3] as Address;
        const attestationValid = Boolean(attestation[5]);
        const stakeActive = Boolean(stakeInfo[2]);

        if (
          attestationValid &&
          existingAttester !== "0x0000000000000000000000000000000000000000" &&
          existingAttester.toLowerCase() !== callerAddress.toLowerCase()
        ) {
          throw new Error(
            `This release is already attested by ${existingAttester} on-chain.`
          );
        }

        const calls: { to: Address; data: Hex; value?: bigint }[] = [];

        if (!attestationValid) {
          calls.push({
            to: cpAddress,
            data: encodeFunctionData({
              abi: ContentProtectionABI,
              functionName: "attestRelease",
              args: [releaseId, params.contentHash, params.fingerprintHash, params.metadataURI],
            }),
          });
        }

        if (!stakeActive) {
          calls.push({
            to: cpAddress,
            data: encodeFunctionData({
              abi: ContentProtectionABI,
              functionName: "stakeForRelease",
              args: [releaseId],
            }),
            value: params.stakeAmountWei,
          });
        }

        if (calls.length === 0) {
          return { hash: "", tokenId: releaseId };
        }

        const hash = await sendBatchContractTransactions(
          publicClient,
          chainId,
          calls,
          address as Address,
          kernelAccount
        );

        setTxHash(hash);
        return { hash, tokenId: releaseId };
      } catch (err) {
        const error = normalizeContractWriteError(err);
        setError(error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, chainId, kernelAccount, smartAccountAddress]
  );

  return { attestAndStake, pending, error, txHash };
}

// ============ Content Protection Read Hooks ============

export interface StakeInfoData {
  amount: bigint;
  depositedAt: bigint;
  active: boolean;
}

/**
 * Hook to read stake info for a token from ContentProtection.stakes(tokenId).
 * Returns raw on-chain data plus derived status and escrow info.
 */
export function useStakeInfo(tokenId: bigint | undefined) {
  const { publicClient, chainId } = useZeroDev();
  const [data, setData] = useState<StakeInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tokenId === undefined) {
      setLoading(false);
      return;
    }

    const fetchStake = async () => {
      try {
        const { getAddresses, ContentProtectionABI } = await import("../contracts_abi/index");
        const addresses = getAddresses(chainId);

        if (addresses.contentProtection === "0x0000000000000000000000000000000000000000") {
          if (mountedRef.current) { setLoading(false); }
          return;
        }

        const result = await publicClient.readContract({
          address: addresses.contentProtection as Address,
          abi: ContentProtectionABI,
          functionName: "stakes",
          args: [tokenId],
        }) as [bigint, bigint, boolean];

        if (mountedRef.current) {
          setData({ amount: result[0], depositedAt: result[1], active: result[2] });
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchStake();
  }, [publicClient, chainId, tokenId]);

  return { data, loading, error };
}

export interface AttestationInfoData {
  contentHash: string;
  fingerprintHash: string;
  metadataURI: string;
  attester: string;
  timestamp: bigint;
  valid: boolean;
}

/**
 * Hook to read attestation info for a token from ContentProtection.attestations(tokenId).
 */
export function useAttestationInfo(tokenId: bigint | undefined) {
  const { publicClient, chainId } = useZeroDev();
  const [data, setData] = useState<AttestationInfoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (tokenId === undefined) {
      setLoading(false);
      return;
    }

    const fetchAttestation = async () => {
      try {
        const { getAddresses, ContentProtectionABI } = await import("../contracts_abi/index");
        const addresses = getAddresses(chainId);

        if (addresses.contentProtection === "0x0000000000000000000000000000000000000000") {
          if (mountedRef.current) { setLoading(false); }
          return;
        }

        const result = await publicClient.readContract({
          address: addresses.contentProtection as Address,
          abi: ContentProtectionABI,
          functionName: "attestations",
          args: [tokenId],
        }) as [string, string, string, string, bigint, boolean];

        if (mountedRef.current) {
          setData({
            contentHash: result[0],
            fingerprintHash: result[1],
            metadataURI: result[2],
            attester: result[3],
            timestamp: result[4],
            valid: result[5],
          });
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    };

    fetchAttestation();
  }, [publicClient, chainId, tokenId]);

  return { data, loading, error };
}

/**
 * Hook to refund a stake after the escrow period has elapsed.
 * Calls ContentProtection.refundStake(tokenId).
 */
export function useStakeRefund() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const refund = useCallback(
    async (tokenId: bigint) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const { getAddresses, ContentProtectionABI } = await import("../contracts_abi/index");
        const addresses = getAddresses(chainId);

        if (addresses.contentProtection === "0x0000000000000000000000000000000000000000") {
          throw new Error("ContentProtection contract not deployed on this chain");
        }

        const data = encodeFunctionData({
          abi: ContentProtectionABI,
          functionName: "refundStake",
          args: [tokenId],
        });

        const hash = await sendContractTransaction(
          publicClient,
          chainId,
          addresses.contentProtection as Address,
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

  return { refund, pending, error, txHash };
}

export interface ReportContentResult {
  hash: string;
  disputeId?: bigint;
  tokenId?: bigint;
  counterStake: bigint;
}

/**
 * Hook to file a real on-chain dispute via CurationRewards.reportContent().
 *
 * The report is submitted from the authenticated smart account and requires the
 * current counter-stake returned by the contract.
 */
export function useReportContent() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, kernelAccount, smartAccountAddress } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const readRequiredCounterStake = useCallback(async () => {
    const addresses = getContractAddresses(chainId);
    if (addresses.curationRewards === ZERO_ADDRESS) {
      throw new Error("CurationRewards is not deployed on this chain.");
    }

    if (!address) {
      return publicClient.readContract({
        address: addresses.curationRewards as Address,
        abi: CurationRewardsABI,
        functionName: "getRequiredCounterStake",
      }) as Promise<bigint>;
    }

    try {
      return await (publicClient.readContract({
        address: addresses.curationRewards as Address,
        abi: CurationRewardsABI,
        functionName: "getRequiredCounterStakeFor",
        args: [address as Address],
      }) as Promise<bigint>);
    } catch {
      return publicClient.readContract({
        address: addresses.curationRewards as Address,
        abi: CurationRewardsABI,
        functionName: "getRequiredCounterStake",
      }) as Promise<bigint>;
    }
  }, [address, chainId, publicClient]);

  const report = useCallback(
    async (params: { tokenId: bigint; evidenceURI: string }) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const addresses = getContractAddresses(chainId);

        if (addresses.curationRewards === ZERO_ADDRESS) {
          throw new Error(
            "CurationRewards is not deployed on this chain. Redeploy protocol contracts and update env config."
          );
        }

        if (addresses.disputeResolution === ZERO_ADDRESS) {
          throw new Error(
            "DisputeResolution is not deployed on this chain. Redeploy protocol contracts and update env config."
          );
        }

        const [counterStake, activeDispute] = await Promise.all([
          readRequiredCounterStake(),
          publicClient.readContract({
            address: addresses.disputeResolution as Address,
            abi: DisputeResolutionABI,
            functionName: "getActiveDispute",
            args: [params.tokenId],
          }) as Promise<bigint>,
        ]);

        if (activeDispute !== 0n) {
          throw new Error("An active dispute already exists for this content record.");
        }

        const hash = await sendContractTransaction(
          publicClient,
          chainId,
          addresses.curationRewards as Address,
          encodeFunctionData({
            abi: CurationRewardsABI,
            functionName: "reportContent",
            args: [params.tokenId, params.evidenceURI],
          }),
          counterStake,
          ((kernelAccount?.address as Address | undefined) ||
            (smartAccountAddress as Address | undefined) ||
            (address as Address)),
          kernelAccount
        );

        setTxHash(hash);
        const receiptInfo = await getReportedDisputeForTransaction(publicClient, hash);

        return {
          hash,
          disputeId: receiptInfo.disputeId,
          tokenId: receiptInfo.tokenId ?? params.tokenId,
          counterStake: receiptInfo.counterStake ?? counterStake,
        } satisfies ReportContentResult;
      } catch (err) {
        const normalized = normalizeContractWriteError(err);
        setError(normalized);
        throw normalized;
      } finally {
        setPending(false);
      }
    },
    [publicClient, chainId, address, status, kernelAccount, smartAccountAddress, readRequiredCounterStake]
  );

  const getRequiredCounterStake = useCallback(async () => {
    return readRequiredCounterStake();
  }, [readRequiredCounterStake]);

  return { report, getRequiredCounterStake, pending, error, txHash };
}

/**
 * Hook to atomically mint and list a stem in a single UserOperation
 */
export function useMintAndListStem() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, token, kernelAccount, smartAccountAddress } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const mintAndList = useCallback(
    async (params: Omit<MintParams, 'to' | 'royaltyReceiver'> & Omit<ListParams, 'tokenId'>) => {

      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }

      setPending(true);
      setError(null);
      setTxHash(null);

      try {
        const addresses = getContractAddresses(chainId);
        const callerAddress =
          (kernelAccount?.address as Address | undefined) ||
          (smartAccountAddress as Address | undefined) ||
          (address as Address);
        const authorization = await resolveMintAuthorization(
          token,
          chainId,
          callerAddress,
          params
        );
        if (authorization) {
          await assertMintAuthorizationSupported(
            publicClient,
            addresses.stemNFT as Address,
            callerAddress
          );
        }

        const tokenURI = authorization?.tokenURI || params.tokenURI;
        const royaltyReceiver =
          authorization?.royaltyReceiver || callerAddress;
        const mintAmount = authorization?.amount || params.amount;
        const remixable = authorization?.remixable ?? params.remixable;
        const parentIds = authorization?.parentIds || params.parentIds;

        if (!tokenURI) {
          throw new Error("tokenURI is required when no mint authorization is provided");
        }

        // 1. Prepare Mint Call
        const mintCall = {
          to: addresses.stemNFT as Address,
          data: (resolvedAddress: Address) => encodeFunctionData({
            abi: StemNFTABI,
            functionName: authorization ? "mintAuthorized" : "mint",
            args: authorization
              ? [
                authorization.to,
                mintAmount,
                tokenURI,
                authorization.protectionId,
                royaltyReceiver,
                BigInt(authorization.royaltyBps),
                remixable,
                parentIds,
                authorization.deadline,
                authorization.nonce,
                authorization.signature,
              ]
              : [
                resolvedAddress,
                mintAmount,
                tokenURI,
                resolvedAddress,
                BigInt(params.royaltyBps),
                remixable,
                parentIds,
              ],
          }),
        };

        // 2. Prepare Approve Call
        const approveCall = {
          to: addresses.stemNFT as Address,
          data: encodeFunctionData({
            abi: StemNFTABI,
            functionName: "setApprovalForAll",
            args: [addresses.marketplace as Address, true],
          }),
        };

        // 3. Prepare List Call
        const listCall = {
          to: addresses.marketplace as Address,
          data: encodeFunctionData({
            abi: StemMarketplaceABI,
            functionName: "listLastMint",
            args: [
              mintAmount,
              params.pricePerUnit,
              params.paymentToken,
              params.durationSeconds,
              authorization?.protectionId ?? BigInt(0),
            ],
          }),
        };

        // 4. Send as a single batch UserOperation
        const hash = await sendBatchContractTransactions(
          publicClient,
          chainId,
          [mintCall, approveCall, listCall],
          address as Address,
          kernelAccount
        );

        const mintedEvents = await getStemMintedEventsForTransaction(publicClient, hash);
        const tokenId = mintedEvents[0]?.tokenId;

        setTxHash(hash);
        return { hash, tokenId };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, token, chainId, kernelAccount, smartAccountAddress]
  );

  return { mintAndList, pending, error, txHash };
}

// ============ Batch Mint & List ============

export interface BatchStemItem {
  stemId: string;
  stemType: string;
  trackTitle: string;
  metadataUri?: string;
}

export type BatchStemStatus = "pending" | "processing" | "done" | "failed";

export interface BatchStemResult {
  stemId: string;
  status: BatchStemStatus;
  tokenId?: bigint;
  error?: string;
}

/**
 * Hook to batch mint & list multiple stems in a single UserOperation.
 *
 * Builds one approval plus N×2 calls (mint + list-last-mint per stem) and sends them
 * as one batch UserOp via sendBatchContractTransactions — one passkey
 * prompt total.
 */
export function useBatchMintAndList() {
  const { publicClient, chainId } = useZeroDev();
  const { address, status, token, kernelAccount, smartAccountAddress } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [results, setResults] = useState<BatchStemResult[]>([]);

  const executeBatch = useCallback(
    async (
      stems: BatchStemItem[],
      options?: {
        pricePerUnit?: bigint;
        durationSeconds?: bigint;
        onProgress?: (results: BatchStemResult[]) => void;
      }
    ) => {
      if (status !== "authenticated" || !address) {
        throw new Error("Wallet not connected");
      }
      if (stems.length === 0) return [];

      setPending(true);
      setError(null);

      const pricePerUnit = options?.pricePerUnit ?? BigInt("10000000000000000"); // 0.01 ETH
      const durationSeconds = options?.durationSeconds ?? BigInt(7 * 24 * 60 * 60); // 7 days

      // Initialize all stems as pending
      const initialResults: BatchStemResult[] = stems.map(s => ({
        stemId: s.stemId,
        status: "pending" as BatchStemStatus,
      }));
      setResults(initialResults);
      options?.onProgress?.(initialResults);

      try {
        const addresses = getContractAddresses(chainId);
        const callerAddress =
          (kernelAccount?.address as Address | undefined) ||
          (smartAccountAddress as Address | undefined) ||
          (address as Address);
        if (!token) {
          throw new Error("Not authenticated");
        }

        // 1. Build approval + N×2 calls array
        const calls: { to: Address; data: Hex | ((addr: Address) => Hex); value?: bigint }[] = [];
        const { authorizations } = await createBatchStemMintAuthorizations(token, {
          authorizations: stems.map((stem) => ({
            stemId: stem.stemId,
            chainId,
            minterAddress: callerAddress,
            to: callerAddress,
            amount: "1",
            royaltyReceiver: callerAddress,
            royaltyBps: 500,
            remixable: true,
            parentIds: [],
          })),
        });
        await assertMintAuthorizationSupported(
          publicClient,
          addresses.stemNFT as Address,
          callerAddress
        );

        calls.push({
          to: addresses.stemNFT as Address,
          data: encodeFunctionData({
            abi: StemNFTABI,
            functionName: "setApprovalForAll",
            args: [addresses.marketplace as Address, true],
          }),
        });

        for (let i = 0; i < stems.length; i++) {
          const authorization = toAuthorizedMintParams(authorizations[i]);

          // Mint call
          calls.push({
            to: addresses.stemNFT as Address,
            data: () => encodeFunctionData({
              abi: StemNFTABI,
              functionName: "mintAuthorized",
              args: [
                authorization.to,
                authorization.amount,
                authorization.tokenURI,
                authorization.protectionId,
                authorization.royaltyReceiver,
                BigInt(authorization.royaltyBps),
                authorization.remixable,
                authorization.parentIds,
                authorization.deadline,
                authorization.nonce,
                authorization.signature,
              ],
            }),
          });

          // List call
          calls.push({
            to: addresses.marketplace as Address,
            data: encodeFunctionData({
              abi: StemMarketplaceABI,
              functionName: "listLastMint",
              args: [
                BigInt(1),
                pricePerUnit,
                ZERO_ADDRESS,
                durationSeconds,
                authorization.protectionId,
              ],
            }),
          });
        }

        // Mark all as processing
        const processingResults: BatchStemResult[] = stems.map(s => ({
          stemId: s.stemId,
          status: "processing" as BatchStemStatus,
        }));
        setResults(processingResults);
        options?.onProgress?.(processingResults);

        // 2. Send as a single batch UserOperation
        const hash = await sendBatchContractTransactions(
          publicClient,
          chainId,
          calls,
          address as Address,
          kernelAccount
        );

        const mintedEvents = await getStemMintedEventsForTransaction(publicClient, hash);
        const tokenIdByTokenUri = new Map(
          mintedEvents.map((event) => [event.tokenURI, event.tokenId] as const)
        );
        const fallbackTokenIds = mintedEvents.map((event) => event.tokenId);

        // 3. All succeeded — mark as done with actual token IDs when available
        const doneResults: BatchStemResult[] = stems.map((s, i) => ({
          stemId: s.stemId,
          status: "done" as BatchStemStatus,
          tokenId: tokenIdByTokenUri.get(authorizations[i].tokenURI) ?? fallbackTokenIds[i],
        }));
        setResults(doneResults);
        options?.onProgress?.(doneResults);

        // 4. Persist locally and notify mounted buttons in the same tab
        for (let i = 0; i < stems.length; i++) {
          const stemId = stems[i].stemId;
          const tokenId =
            tokenIdByTokenUri.get(authorizations[i].tokenURI) ?? fallbackTokenIds[i];
          if (tokenId == null) continue;
          persistStemMarketplaceStatus(stemId, "listed", tokenId);
        }

        // 5. Notify backend for each stem (best-effort, non-blocking)
        for (let i = 0; i < stems.length; i++) {
          const tokenId =
            tokenIdByTokenUri.get(authorizations[i].tokenURI) ?? fallbackTokenIds[i];
          if (tokenId == null) continue;
          fetch("/api/contracts/notify-listing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tokenId: tokenId.toString(),
              seller: callerAddress,
              price: pricePerUnit.toString(),
              amount: "1",
              paymentToken: ZERO_ADDRESS,
              durationSeconds: durationSeconds.toString(),
              transactionHash: hash,
              stemId: stems[i].stemId,
            }),
          }).catch(() => { /* indexer will catch up */ });
        }

        return doneResults;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);

        // Mark all as failed
        const failedResults: BatchStemResult[] = stems.map(s => ({
          stemId: s.stemId,
          status: "failed" as BatchStemStatus,
          error: error.message,
        }));
        setResults(failedResults);
        options?.onProgress?.(failedResults);

        throw error;
      } finally {
        setPending(false);
      }
    },
    [publicClient, address, status, token, chainId, kernelAccount, smartAccountAddress]
  );

  return { executeBatch, pending, error, results };
}

// Helper to send batch transactions via Kernel client (unified path)
async function sendBatchContractTransactions(
  publicClient: PublicClient,
  chainId: number,
  calls: { to: Address; data: Hex | ((addr: Address) => Hex); value?: bigint }[],
  userAddress?: Address,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kernelAccount?: any
): Promise<string> {
  const sdk = await import("@zerodev/sdk");
  const { createKernelAccountClient, constants } = sdk;

  let account = kernelAccount;

  if (!account) {
    const projectId = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID;
    const passkey = await import("@zerodev/passkey-validator");
    const { toPasskeyValidator, toWebAuthnKey, PasskeyValidatorContractVersion } = passkey;

    const { entryPoint, factoryAddress } = getKernelAccountConfig(chainId);
    const kernelVersion = constants.KERNEL_V3_1;

    const passkeyServerUrl = projectId
      ? `/api/zerodev/${projectId}`
      : `/api/zerodev/self-hosted`;

    const webAuthnKey = await toWebAuthnKey({
      passkeyName: "Resonate",
      passkeyServerUrl,
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
      factoryAddress,
    });
  }

  // Auto-fund on local dev
  const totalValue = calls.reduce((sum, c) => sum + (c.value || BigInt(0)), BigInt(0));
  await ensureLocalFunding(publicClient, account.address as Address, totalValue);

  const bundlerUrl = getBundlerUrl(chainId);
  const mappedTransport = createMappedTransport(bundlerUrl);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientOpts: any = {
    account,
    chain: publicClient.chain,
    bundlerTransport: mappedTransport,
  };

  if (!isLocalDevEnvironment(chainId)) {
    const { createZeroDevPaymasterClient } = await import("@zerodev/sdk");
    clientOpts.paymaster = createZeroDevPaymasterClient({
      chain: publicClient.chain,
      transport: http(bundlerUrl),
    });
  }

  const kernelClient = await createKernelAccountClient(clientOpts);

  // Send batch as a single UserOperation
  let userOpHash: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userOpHash = await (kernelClient as any).sendUserOperation({
      calls: calls.map(c => ({
        to: c.to,
        data: typeof c.data === 'function' ? c.data(account.address as Address) : c.data,
        value: c.value || BigInt(0),
      })),
    });
  } catch (error) {
    throw normalizeContractWriteError(error);
  }

  let receipt: { receipt: { transactionHash: string } };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    receipt = await (kernelClient as unknown as any).waitForUserOperationReceipt({
      hash: userOpHash,
    });
  } catch (error) {
    throw normalizeContractWriteError(error);
  }

  const hash = receipt.receipt.transactionHash;
  console.log("[AA] Batch Transaction submitted! Hash:", hash);
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
