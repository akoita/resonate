import { ForbiddenException } from '@nestjs/common';
import {
  PaymentNotBoundToBuyerException,
  assertPaymentBoundToBuyer,
  paymentBindingTypedData,
} from '../modules/x402/x402.payer-binding';

const BUYER = '0x1111111111111111111111111111111111111111';
const STRANGER = '0x2222222222222222222222222222222222222222';
const PARALLEL_ACCOUNT = '0x3333333333333333333333333333333333333333';

function input(overrides: Partial<Parameters<typeof assertPaymentBoundToBuyer>[0]> = {}) {
  const verifyTypedData = jest.fn().mockResolvedValue(false);
  return {
    verifyTypedData,
    args: {
      buyerId: BUYER,
      payer: STRANGER as `0x${string}`,
      resource: { kind: 'stem' as const, id: 'stem_1' },
      chainId: 84532,
      isAddressForUser: jest.fn(async (userId: string, address: string) =>
        userId.toLowerCase() === address.toLowerCase(),
      ),
      getPublicClient: () => ({ verifyTypedData }) as any,
      ...overrides,
    },
  };
}

describe('assertPaymentBoundToBuyer', () => {
  it("accepts a payment from one of the buyer's own addresses without a signature", async () => {
    const { args, verifyTypedData } = input({ payer: BUYER as `0x${string}` });

    await expect(assertPaymentBoundToBuyer(args)).resolves.toBe('buyer_address');
    expect(verifyTypedData).not.toHaveBeenCalled();
  });

  it("refuses someone else's payment when no signature binds it", async () => {
    const { args } = input();

    await expect(assertPaymentBoundToBuyer(args)).rejects.toBeInstanceOf(
      PaymentNotBoundToBuyerException,
    );
    await expect(assertPaymentBoundToBuyer(args)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts a parallel account that signed the binding for this buyer, resource and transaction', async () => {
    const { args, verifyTypedData } = input({
      payer: PARALLEL_ACCOUNT as `0x${string}`,
      payerSignature: '0xabcdef',
    });
    verifyTypedData.mockResolvedValue(true);

    await expect(assertPaymentBoundToBuyer(args)).resolves.toBe('payer_signature');
    expect(verifyTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        address: PARALLEL_ACCOUNT,
        signature: '0xabcdef',
        primaryType: 'PaymentBinding',
        domain: { name: 'Resonate x402', version: '1', chainId: 84532 },
        message: { resource: 'stem:stem_1', buyer: BUYER },
      }),
    );
  });

  it('refuses a signature that does not verify', async () => {
    const { args } = input({ payerSignature: '0xabcdef' });

    await expect(assertPaymentBoundToBuyer(args)).rejects.toBeInstanceOf(
      PaymentNotBoundToBuyerException,
    );
  });

  it('refuses when the validator reverts or the RPC fails', async () => {
    const { args, verifyTypedData } = input({ payerSignature: '0xabcdef' });
    verifyTypedData.mockRejectedValue(new Error('execution reverted'));

    await expect(assertPaymentBoundToBuyer(args)).rejects.toBeInstanceOf(
      PaymentNotBoundToBuyerException,
    );
  });

  it('refuses a malformed signature without calling the chain', async () => {
    const { args, verifyTypedData } = input({ payerSignature: 'not-hex' });

    await expect(assertPaymentBoundToBuyer(args)).rejects.toBeInstanceOf(
      PaymentNotBoundToBuyerException,
    );
    expect(verifyTypedData).not.toHaveBeenCalled();
  });

  it('fails closed without a buyer or an ownership check', async () => {
    await expect(
      assertPaymentBoundToBuyer(input({ buyerId: '' }).args),
    ).rejects.toBeInstanceOf(PaymentNotBoundToBuyerException);
    await expect(
      assertPaymentBoundToBuyer(input({ isAddressForUser: undefined, payer: BUYER as `0x${string}` }).args),
    ).rejects.toBeInstanceOf(PaymentNotBoundToBuyerException);
  });

  it('binds a signature to its resource and buyer, so it cannot be reused elsewhere', () => {
    const stem = paymentBindingTypedData({
      chainId: 84532,
      resource: { kind: 'stem', id: 'stem_1' },
      buyer: BUYER,
    });
    const otherStem = paymentBindingTypedData({
      chainId: 84532,
      resource: { kind: 'stem', id: 'stem_2' },
      buyer: BUYER,
    });
    const moment = paymentBindingTypedData({
      chainId: 84532,
      resource: { kind: 'moment', id: 'stem_1' },
      buyer: BUYER,
    });
    const otherBuyer = paymentBindingTypedData({
      chainId: 84532,
      resource: { kind: 'stem', id: 'stem_1' },
      buyer: STRANGER,
    });

    expect(stem.message.resource).toBe('stem:stem_1');
    expect(otherStem.message.resource).not.toBe(stem.message.resource);
    expect(moment.message.resource).not.toBe(stem.message.resource);
    expect(otherBuyer.message.buyer).not.toBe(stem.message.buyer);
  });

  it('normalizes the buyer id so casing cannot change what is signed', () => {
    const upper = paymentBindingTypedData({
      chainId: 84532,
      resource: { kind: 'stem', id: 'stem_1' },
      buyer: BUYER.toUpperCase().replace('0X', '0x'),
    });

    expect(upper.message.buyer).toBe(BUYER);
  });

  it('passes the local universal signature validator on the local chain', async () => {
    const { args, verifyTypedData } = input({ chainId: 31337, payerSignature: '0xabcdef' });
    verifyTypedData.mockResolvedValue(true);

    await assertPaymentBoundToBuyer(args);

    expect(verifyTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        universalSignatureValidatorAddress: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0',
      }),
    );
  });
});
