import { recoverMessageAddress, type PublicClient } from "viem";
import { LOCAL_CHAIN_ID, LOCAL_UNIVERSAL_SIG_VALIDATOR } from "../shared/local_signature_validator";
import type { AuthService } from "./auth.service";

/** What actually convinced us the signature was real. */
export type WalletSignatureMode =
  /** The claimed address recovered directly from the signature (plain EOA). */
  | "eoa"
  /** ERC-1271/ERC-6492 said yes: a deployed (or counterfactual) smart account. */
  | "erc1271"
  /** The signature recovered to another address this same person owns. */
  | "recovered_eoa";

/**
 * Whether `signature` is a fresh signature over exactly `message` from the
 * authenticated person (#1771 slice 3b, shared with the admin step-up in #2173).
 *
 * For a passkey account the signature *is* a passkey assertion made through the
 * smart account, checked here via ERC-6492/ERC-1271. Returns `null` for anything
 * that is not proven; callers must fail closed on `null`.
 *
 * The caller owns everything around it: checking the address belongs to the
 * person, rebuilding the message from server state, and spending the nonce.
 */
export async function checkWalletSignature(
  deps: { publicClient: PublicClient; authService: Pick<AuthService, "isAddressForUser"> },
  input: {
    userId: string;
    address: `0x${string}`;
    message: string;
    signature: `0x${string}`;
  },
): Promise<WalletSignatureMode | null> {
  // Offline recovery first. It costs no RPC call and settles the plain-EOA
  // case, which an on-chain check alone would miss: an EOA has no code, and a
  // bytecode check cannot tell one apart from a counterfactual smart account.
  const recovered = await recoverSigner(input.message, input.signature);
  if (recovered && recovered.toLowerCase() === input.address.toLowerCase()) {
    return "eoa";
  }

  const chainId = await chainIdOf(deps.publicClient);

  // Deliberately NOT gated on the account having code. ERC-6492 exists for
  // exactly the account that has none yet: viem validates a wrapped signature
  // through a deployless call that runs the factory from the wrapper and then
  // asks ERC-1271. Requiring bytecode first would skip that path for every
  // counterfactual smart account (most passkey accounts that have never
  // transacted). The extra call costs nothing for an EOA, which has already
  // returned above.
  const verifyOptions: Parameters<PublicClient["verifyMessage"]>[0] & {
    universalSignatureValidatorAddress?: `0x${string}`;
  } = {
    address: input.address,
    message: input.message,
    signature: input.signature,
  };
  if (chainId === LOCAL_CHAIN_ID) {
    verifyOptions.universalSignatureValidatorAddress = LOCAL_UNIVERSAL_SIG_VALIDATOR;
  }
  try {
    if (await deps.publicClient.verifyMessage(verifyOptions)) {
      return "erc1271";
    }
  } catch {
    // A validator that reverts is a "no", not an outage: fall through.
  }

  // A smart account whose owner EOA signed on its behalf. Accepted only when
  // the recovered signer is itself an address of this same person, so this
  // stays a proof about *this account* rather than about any wallet.
  if (recovered && (await deps.authService.isAddressForUser(input.userId, recovered))) {
    return "recovered_eoa";
  }

  return null;
}

async function recoverSigner(message: string, signature: `0x${string}`) {
  try {
    return await recoverMessageAddress({ message, signature });
  } catch {
    return null;
  }
}

async function chainIdOf(publicClient: PublicClient) {
  try {
    return await publicClient.getChainId();
  } catch {
    return null;
  }
}
