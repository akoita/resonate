import type { Address } from "viem";

const LOCAL_AA_DEFAULTS = {
  entryPoint: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  factory: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
} as const;

const SEPOLIA_AA_DEFAULTS = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
} as const;

// Kernel V3.1 canonical addresses on Base / Base Sepolia. The basic factory and the
// EntryPoint v0.7 are deployed at the same deterministic addresses across
// every chain ZeroDev supports, so we reuse the canonical V3.1 factory rather
// than the metaFactory (those have different roles inside createKernelAccount
// — the metaFactory is filled in from the SDK's KernelVersionToAddressesMap).
const BASE_AA_DEFAULTS = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
} as const;

export function getKernelAccountConfig(chainId: number) {
  if (chainId === 8453 || chainId === 84532) {
    return {
      entryPoint: {
        address: BASE_AA_DEFAULTS.entryPoint as Address,
        version: "0.7" as const,
      },
      factoryAddress: BASE_AA_DEFAULTS.factory as Address,
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
