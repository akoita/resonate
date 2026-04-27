import type { Address } from "viem";

const LOCAL_AA_DEFAULTS = {
  entryPoint: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  factory: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
} as const;

const SEPOLIA_AA_DEFAULTS = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
} as const;

// Kernel V3.1 metaFactory + canonical EntryPoint v0.7 on Base Sepolia.
// Used by the x402 payment path so the smart account address resolves on the
// chain where Circle USDC + the x402 facilitator live.
const BASE_SEPOLIA_AA_DEFAULTS = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  factory: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
} as const;

export function getKernelAccountConfig(chainId: number) {
  if (chainId === 84532) {
    return {
      entryPoint: {
        address: BASE_SEPOLIA_AA_DEFAULTS.entryPoint as Address,
        version: "0.7" as const,
      },
      factoryAddress: BASE_SEPOLIA_AA_DEFAULTS.factory as Address,
    };
  }
  const defaults = chainId === 31337 ? LOCAL_AA_DEFAULTS : SEPOLIA_AA_DEFAULTS;
  const entryPointAddress = (process.env.NEXT_PUBLIC_AA_ENTRY_POINT ?? defaults.entryPoint) as Address;
  const factoryAddress = (process.env.NEXT_PUBLIC_AA_FACTORY ?? defaults.factory) as Address;

  return {
    entryPoint: {
      address: entryPointAddress,
      version: "0.7" as const,
    },
    factoryAddress,
  };
}
