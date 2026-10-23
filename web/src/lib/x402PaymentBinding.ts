/**
 * The typed data a paying smart account signs to show that a payment belongs
 * to the signed-in buyer, when it pays from an address the server does not
 * already know as the buyer's (x402 settling on another chain than sign-in).
 *
 * It names the resource and the buyer but not the transaction, so checkout can
 * sign it before any money moves. Identical to
 * `backend/src/modules/x402/x402.payer-binding.ts`; change both together, or
 * every such signature stops verifying.
 */

export type PaymentBindingResource = { kind: "stem" | "moment"; id: string };

export const PAYMENT_BINDING_TYPES = {
  PaymentBinding: [
    { name: "resource", type: "string" },
    { name: "buyer", type: "string" },
  ],
} as const;

export function paymentBindingTypedData(input: {
  chainId: number;
  resource: PaymentBindingResource;
  buyer: string;
}) {
  return {
    domain: { name: "Resonate x402", version: "1", chainId: input.chainId },
    types: PAYMENT_BINDING_TYPES,
    primaryType: "PaymentBinding" as const,
    message: {
      resource: `${input.resource.kind}:${input.resource.id}`,
      buyer: input.buyer.toLowerCase(),
    },
  };
}

/** Whether the server already knows `payer` as one of the buyer's addresses, so no signature is needed. */
export function payerIsKnownBuyerAddress(
  payer: string,
  buyerAddresses: Array<string | null | undefined>,
): boolean {
  const normalized = payer.toLowerCase();
  return buyerAddresses.some((address) => typeof address === "string" && address.toLowerCase() === normalized);
}

/** The server's refusal when a payment is not bound to the signed-in buyer. */
export const PAYER_NOT_LINKED_CODE = "payer_not_linked";
