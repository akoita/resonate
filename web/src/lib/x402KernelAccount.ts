import { createPublicClient, http, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { getKernelAccountConfig } from "./accountAbstraction";

/**
 * The x402 payment layer uses Base Sepolia (chain 84532), because Circle's
 * official USDC with EIP-3009 support and the public x402 facilitator both run
 * there.
 *
 * Legacy deployments may still authenticate the main app on Sepolia while x402
 * settles on Base Sepolia. That split means the Sepolia smart account the user
 * sees in the wallet badge is not deployed on Base Sepolia. CREATE2 with a
 * different factory address yields a different counterfactual address. To make
 * x402 work in that mode, we build a parallel Kernel account on Base Sepolia
 * using the same passkey, and use it as the x402 signer. Single-chain staging
 * should instead configure the main app and x402 on Base Sepolia together.
 *
 * Callers must fund USDC at the Base Sepolia SA address — funding the Sepolia
 * SA address does nothing for x402 settlement.
 */

const X402_CHAIN = baseSepolia;

export type X402KernelAccount = {
  address: `0x${string}`;
  factoryAddress: `0x${string}`;
  generateInitCode: () => Promise<`0x${string}`>;
  signTypedData: (msg: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
  isDeployed?: () => Promise<boolean>;
  getFactoryArgs?: () => Promise<{
    factory?: `0x${string}`;
    factoryData?: `0x${string}`;
  }>;
};

export type GetX402KernelAccountInput = {
  webAuthnKey: unknown;
  /** Optional viem public client for Base Sepolia. Constructed if omitted. */
  publicClient?: PublicClient;
};

let cachedAccount: X402KernelAccount | null = null;
let cachedKey: unknown = null;

/**
 * Build (or reuse) the Base Sepolia Kernel smart account that x402 signs
 * with. Reuses the user's already-authenticated passkey so this never
 * triggers a new WebAuthn prompt.
 */
export async function getX402KernelAccount(
  input: GetX402KernelAccountInput,
): Promise<X402KernelAccount> {
  if (!input.webAuthnKey) {
    throw new Error(
      "x402 requires the user's WebAuthn passkey; sign in before invoking x402.",
    );
  }
  if (cachedAccount && cachedKey === input.webAuthnKey) {
    return cachedAccount;
  }

  const sdk = await import("@zerodev/sdk");
  const { createKernelAccount, constants } = sdk;
  const passkey = await import("@zerodev/passkey-validator");
  const { toPasskeyValidator, PasskeyValidatorContractVersion } = passkey;

  const publicClient =
    input.publicClient ??
    createPublicClient({
      chain: X402_CHAIN,
      transport: http(),
    });

  const { entryPoint, factoryAddress } = getKernelAccountConfig(X402_CHAIN.id);
  const kernelVersion = constants.KERNEL_V3_1;

  const passkeyValidator = await toPasskeyValidator(publicClient, {
    webAuthnKey: input.webAuthnKey as never,
    entryPoint,
    kernelVersion,
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_1_UNPATCHED,
  });

  const account = (await createKernelAccount(publicClient, {
    plugins: { sudo: passkeyValidator },
    entryPoint,
    kernelVersion,
    factoryAddress,
  })) as unknown as X402KernelAccount;

  if (
    !account.address ||
    account.address.toLowerCase() === "0x0000000000000000000000000000000000000000"
  ) {
    // Don't cache: a zero address means the SDK couldn't resolve the
    // counterfactual SA via the EntryPoint (usually wrong factory or the
    // contracts aren't deployed on this chain). Surfacing as an error gives
    // callers something to display instead of a silently broken signer.
    throw new Error(
      "x402 Kernel account resolved to the zero address; check Base Sepolia factory + EntryPoint deployment.",
    );
  }

  cachedAccount = account;
  cachedKey = input.webAuthnKey;
  return account;
}

/**
 * Drop the cached account. Useful for tests and after sign-out.
 */
export function resetX402KernelAccountCache(): void {
  cachedAccount = null;
  cachedKey = null;
}

export const X402_CHAIN_ID = X402_CHAIN.id;
