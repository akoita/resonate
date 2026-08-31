import type { Address } from "viem";

const LOCAL_AA_DEFAULTS = {
  entryPoint: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  implementation: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  factory: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
} as const;

const SEPOLIA_AA_DEFAULTS = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  implementation: "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
} as const;

// Kernel V3.1 canonical addresses on Base / Base Sepolia. The basic factory and the
// EntryPoint v0.7 are deployed at the same deterministic addresses across
// every chain ZeroDev supports, so we reuse the canonical V3.1 factory rather
// than the metaFactory (those have different roles inside createKernelAccount
// — the metaFactory is filled in from the SDK's KernelVersionToAddressesMap).
const BASE_AA_DEFAULTS = {
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  implementation: "0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D",
  factory: "0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419",
} as const;

export const RESONATE_KERNEL_VERSION = "0.3.1" as const;

function configuredKernelVersion(): typeof RESONATE_KERNEL_VERSION {
  const configured = process.env.NEXT_PUBLIC_AA_KERNEL_VERSION;
  if (configured && configured !== RESONATE_KERNEL_VERSION) {
    throw new Error(
      `Unsupported local Kernel version ${configured}; expected ${RESONATE_KERNEL_VERSION}.`,
    );
  }
  return RESONATE_KERNEL_VERSION;
}

export function getKernelAccountConfig(chainId: number) {
  if (chainId === 8453 || chainId === 84532) {
    return {
      entryPoint: {
        address: BASE_AA_DEFAULTS.entryPoint as Address,
        version: "0.7" as const,
      },
      accountImplementationAddress: BASE_AA_DEFAULTS.implementation as Address,
      factoryAddress: BASE_AA_DEFAULTS.factory as Address,
      kernelVersion: configuredKernelVersion(),
      useMetaFactory: true,
    };
  }
  const defaults = chainId === 31337 ? LOCAL_AA_DEFAULTS : SEPOLIA_AA_DEFAULTS;
  const entryPointAddress = (process.env.NEXT_PUBLIC_AA_ENTRY_POINT ?? defaults.entryPoint) as Address;
  const accountImplementationAddress = (
    process.env.NEXT_PUBLIC_AA_KERNEL ?? defaults.implementation
  ) as Address;
  const factoryAddress = (process.env.NEXT_PUBLIC_AA_FACTORY ?? defaults.factory) as Address;
  const configuredMetaFactory = process.env.NEXT_PUBLIC_AA_USE_META_FACTORY;
  const useMetaFactory = configuredMetaFactory
    ? configuredMetaFactory === "true"
    : chainId === 11155111;

  return {
    entryPoint: {
      address: entryPointAddress,
      version: "0.7" as const,
    },
    accountImplementationAddress,
    factoryAddress,
    kernelVersion: configuredKernelVersion(),
    useMetaFactory,
  };
}
