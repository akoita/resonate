import { ForbiddenException } from '@nestjs/common';
import type { Address, Hex, PublicClient } from 'viem';

/**
 * Binding a smart-account x402 payment to the signed-in buyer.
 *
 * The human smart-account rails (stem download, Punchline moment collect)
 * verify a USDC transfer from `payer` by its transaction hash. A transaction
 * hash and its sender are public on-chain, so the verified transfer proves
 * that a payment happened, not who is redeeming it. Redemption must therefore
 * be tied to the signed-in buyer, or anyone who reads the chain could redeem
 * someone else's payment.
 *
 * The payer is accepted when it is one of the buyer's own addresses (the
 * sign-in smart account or its owner), which is the normal single-chain case.
 * When x402 settles on another chain than sign-in, the browser pays from a
 * parallel Kernel account built from the same passkey, whose address differs;
 * that account then signs {@link PAYMENT_BINDING_TYPES} ("I pay for this
 * resource on behalf of this buyer").
 *
 * The transaction hash is deliberately not part of the signed message, so the
 * browser can sign before any money moves: a cancelled prompt then costs
 * nothing. Only the paying account can produce the signature and it names the
 * buyer, so it lets nobody but that buyer redeem payments from that account.
 *
 * The frontend keeps an identical definition in
 * `web/src/lib/x402PaymentBinding.ts`; change both together.
 */

export const PAYMENT_BINDING_DOMAIN_NAME = 'Resonate x402';
export const PAYMENT_BINDING_DOMAIN_VERSION = '1';

export const PAYMENT_BINDING_TYPES = {
  PaymentBinding: [
    { name: 'resource', type: 'string' },
    { name: 'buyer', type: 'string' },
  ],
} as const;

/** Accepted signature size: a passkey (WebAuthn) Kernel signature, possibly ERC-6492-wrapped (≤ 8 KiB). */
export const PAYMENT_BINDING_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{2,16384}$/;

const LOCAL_CHAIN_ID = 31337;
const LOCAL_UNIVERSAL_SIG_VALIDATOR = '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0';

export type PaymentBindingResource = { kind: 'stem' | 'moment'; id: string };

export function paymentBindingResource(resource: PaymentBindingResource): string {
  return `${resource.kind}:${resource.id}`;
}

export function paymentBindingTypedData(input: {
  chainId: number;
  resource: PaymentBindingResource;
  buyer: string;
}) {
  return {
    domain: {
      name: PAYMENT_BINDING_DOMAIN_NAME,
      version: PAYMENT_BINDING_DOMAIN_VERSION,
      chainId: input.chainId,
    },
    types: PAYMENT_BINDING_TYPES,
    primaryType: 'PaymentBinding' as const,
    message: {
      resource: paymentBindingResource(input.resource),
      buyer: input.buyer.toLowerCase(),
    },
  };
}

export class PaymentNotBoundToBuyerException extends ForbiddenException {
  constructor() {
    super({
      code: 'payer_not_linked',
      message:
        'This payment was not made from your account. Sign in with the passkey that paid and try again.',
    });
  }
}

export type PaymentBindingProof = 'buyer_address' | 'payer_signature';

/**
 * Prove that `payer` belongs to `buyerId` for this payment, or throw
 * {@link PaymentNotBoundToBuyerException}. Fails closed: a missing ownership
 * check, a missing or unverifiable signature, and a reverting validator all
 * refuse.
 */
export async function assertPaymentBoundToBuyer(input: {
  buyerId: string;
  payer: Address;
  resource: PaymentBindingResource;
  payerSignature?: string | null;
  chainId: number;
  isAddressForUser?: (userId: string, address: string) => Promise<boolean>;
  getPublicClient: () => Pick<PublicClient, 'verifyTypedData'>;
}): Promise<PaymentBindingProof> {
  if (!input.buyerId || !input.isAddressForUser) {
    throw new PaymentNotBoundToBuyerException();
  }
  if (await input.isAddressForUser(input.buyerId, input.payer)) {
    return 'buyer_address';
  }

  const signature = input.payerSignature?.trim();
  if (!signature || !PAYMENT_BINDING_SIGNATURE_PATTERN.test(signature)) {
    throw new PaymentNotBoundToBuyerException();
  }

  const typedData = paymentBindingTypedData({
    chainId: input.chainId,
    resource: input.resource,
    buyer: input.buyerId,
  });
  const verifyOptions: Parameters<PublicClient['verifyTypedData']>[0] & {
    universalSignatureValidatorAddress?: Address;
  } = {
    address: input.payer,
    ...typedData,
    signature: signature as Hex,
  };
  if (input.chainId === LOCAL_CHAIN_ID) {
    verifyOptions.universalSignatureValidatorAddress = LOCAL_UNIVERSAL_SIG_VALIDATOR;
  }

  let valid = false;
  try {
    valid = await input.getPublicClient().verifyTypedData(verifyOptions);
  } catch {
    // A validator that reverts, or an unreachable RPC, is a refusal, not a pass.
    valid = false;
  }
  if (!valid) {
    throw new PaymentNotBoundToBuyerException();
  }
  return 'payer_signature';
}
