import {
  createWalletClient,
  custom,
  defineChain,
  numberToHex,
  type Chain,
  type EIP1193Provider,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type { X402EvmSigner } from "./x402Pay";

type EthereumProviderError = Error & {
  code?: number;
};

type BrowserWalletResult = {
  signer: X402EvmSigner;
  address: `0x${string}`;
};

const X402_RPC_URL = process.env.NEXT_PUBLIC_X402_RPC_URL;

export function getX402Chain(chainId: number): Chain {
  const rpcUrl = X402_RPC_URL;
  if (chainId === baseSepolia.id) {
    return rpcUrl
      ? { ...baseSepolia, rpcUrls: withRpcUrl(baseSepolia, rpcUrl) }
      : baseSepolia;
  }
  if (chainId === base.id) {
    return rpcUrl
      ? { ...base, rpcUrls: withRpcUrl(base, rpcUrl) }
      : base;
  }

  if (!rpcUrl) {
    throw new Error(
      `x402 is configured for chain ${chainId}. Set NEXT_PUBLIC_X402_RPC_URL so Resonate can add or switch to that network.`,
    );
  }

  return defineChain({
    id: chainId,
    name: `x402 chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  });
}

export function getX402ChainName(chainId: number | null | undefined): string {
  if (!chainId) return "the configured x402 network";
  if (chainId === baseSepolia.id) return "Base Sepolia";
  if (chainId === base.id) return "Base";
  return `chain ${chainId}`;
}

export async function createX402BrowserWalletSigner(
  chainId: number,
): Promise<BrowserWalletResult> {
  const provider = getInjectedEthereumProvider();
  const [address] = await provider.request({
    method: "eth_requestAccounts",
  }) as `0x${string}`[];

  if (!address) {
    throw new Error("No browser wallet account was selected.");
  }

  const chain = getX402Chain(chainId);
  await switchOrAddChain(provider, chain);

  const walletClient = createWalletClient({
    account: address,
    chain,
    transport: custom(provider),
  });

  return {
    address,
    signer: {
      address,
      signTypedData: (message) =>
        walletClient.signTypedData({
          account: address,
          domain: message.domain,
          types: message.types,
          primaryType: message.primaryType,
          message: message.message,
        } as never),
    },
  };
}

function getInjectedEthereumProvider(): EIP1193Provider {
  if (typeof window === "undefined") {
    throw new Error("x402 checkout is only available in a browser.");
  }
  const ethereum = (
    window as Window & {
      ethereum?: EIP1193Provider;
    }
  ).ethereum;
  if (!ethereum) {
    throw new Error(
      "No browser wallet was found. Install or enable a wallet with USDC on the x402 network.",
    );
  }
  return ethereum;
}

async function switchOrAddChain(provider: EIP1193Provider, chain: Chain) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: numberToHex(chain.id) }],
    });
    return;
  } catch (error) {
    const err = error as EthereumProviderError;
    if (err.code !== 4902) {
      throw error;
    }
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: numberToHex(chain.id),
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: chain.blockExplorers?.default
          ? [chain.blockExplorers.default.url]
          : undefined,
      },
    ],
  });
}

function withRpcUrl(chain: Chain, rpcUrl: string): Chain["rpcUrls"] {
  return {
    ...chain.rpcUrls,
    default: { ...chain.rpcUrls.default, http: [rpcUrl] },
    public: { ...chain.rpcUrls.public, http: [rpcUrl] },
  };
}
