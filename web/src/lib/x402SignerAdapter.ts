import {
  createPublicClient,
  http,
  serializeErc6492Signature,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import type { X402EvmSigner } from "./x402Pay";

/**
 * The Kernel smart account is deployed lazily, on its first userOp. The x402
 * facilitator's exact-EVM scheme verifies signatures via ERC-1271, which
 * requires the smart account contract to exist on-chain. For accounts that
 * have not been deployed yet, the signature must be wrapped per ERC-6492 so
 * the facilitator can resolve the counterfactual address before validating.
 *
 * This adapter intercepts signTypedData, asks the chain whether the account
 * has bytecode, and only wraps the signature when it does not.
 */

type KernelAccountLike = {
  address: `0x${string}`;
  factoryAddress: `0x${string}`;
  generateInitCode: () => Promise<Hex>;
  signTypedData: (msg: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
};

export type X402SignerAdapterDeps = {
  account: KernelAccountLike;
  /** Used to read bytecode at the smart-account address. */
  publicClient?: Pick<PublicClient, "getBytecode">;
};

/**
 * Builds an X402EvmSigner that wraps signatures with ERC-6492 envelopes when
 * the underlying Kernel smart account has not yet been deployed.
 */
export function createX402KernelSigner(deps: X402SignerAdapterDeps & {
  rpcUrl?: string;
}): X402EvmSigner {
  const { account, rpcUrl } = deps;
  const publicClient =
    deps.publicClient ??
    createPublicClient({ transport: http(rpcUrl) as Transport });

  return {
    address: account.address,
    async signTypedData(msg) {
      const innerSignature = await account.signTypedData(msg);
      const wrapped = await maybeWrapErc6492({
        account,
        publicClient,
        signature: innerSignature,
      });
      return wrapped;
    },
  };
}

/**
 * Returns either the original signature (if the account is deployed) or an
 * ERC-6492 envelope including the deployment factory + calldata.
 */
export async function maybeWrapErc6492(input: {
  account: KernelAccountLike;
  publicClient: Pick<PublicClient, "getBytecode">;
  signature: Hex;
}): Promise<Hex> {
  const { account, publicClient, signature } = input;
  const bytecode = await publicClient.getBytecode({ address: account.address });
  if (bytecode && bytecode !== "0x") {
    return signature;
  }

  const initCode = await account.generateInitCode();
  const { factoryAddress, factoryCalldata } = splitInitCode(initCode, account.factoryAddress);

  return serializeErc6492Signature({
    address: factoryAddress,
    data: factoryCalldata,
    signature,
  });
}

/**
 * ERC-4337 init code is `factoryAddress (20 bytes) || factoryCalldata`. Split
 * it back into its components, falling back to the account's declared
 * factoryAddress when the init code is empty.
 */
export function splitInitCode(
  initCode: Hex,
  fallbackFactory: `0x${string}`,
): { factoryAddress: `0x${string}`; factoryCalldata: Hex } {
  if (!initCode || initCode === "0x" || initCode.length < 42) {
    return { factoryAddress: fallbackFactory, factoryCalldata: "0x" };
  }
  const factoryAddress = (`0x${initCode.slice(2, 42)}`) as `0x${string}`;
  const factoryCalldata = (`0x${initCode.slice(42)}`) as Hex;
  return { factoryAddress, factoryCalldata };
}
