/**
 * Wallet amount value rules (#2361). DTOs only check types; the service owns
 * "positive, finite, bounded". Rejection must happen before any DB access.
 */
import { BadRequestException } from '@nestjs/common';
import {
  MAX_WALLET_AMOUNT_USD,
  WalletService,
  assertValidFundAmount,
  assertValidMonthlyCap,
} from '../modules/identity/wallet.service';

describe('wallet amount rules', () => {
  describe('fund amount', () => {
    it.each([0, -1, -0.01, NaN, Infinity, -Infinity, MAX_WALLET_AMOUNT_USD + 0.01])(
      'rejects %p',
      (v) => expect(() => assertValidFundAmount(v)).toThrow(BadRequestException),
    );
    it.each(['10', null, undefined, {}])('rejects non-number %p', (v) =>
      expect(() => assertValidFundAmount(v)).toThrow(BadRequestException),
    );
    it.each([0.01, 1, MAX_WALLET_AMOUNT_USD])('accepts %p', (v) =>
      expect(() => assertValidFundAmount(v)).not.toThrow(),
    );
  });

  describe('monthly cap', () => {
    it.each([-1, -0.01, NaN, Infinity, -Infinity, MAX_WALLET_AMOUNT_USD + 1])(
      'rejects %p',
      (v) => expect(() => assertValidMonthlyCap(v)).toThrow(BadRequestException),
    );
    it.each(['5', null, undefined])('rejects non-number %p', (v) =>
      expect(() => assertValidMonthlyCap(v)).toThrow(BadRequestException),
    );
    it.each([0, 0.5, MAX_WALLET_AMOUNT_USD])('accepts %p (0 = spending paused)', (v) =>
      expect(() => assertValidMonthlyCap(v)).not.toThrow(),
    );
  });

  it('service methods reject before publishing or touching the database', async () => {
    const publish = jest.fn();
    const svc = new WalletService({ publish } as any, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.fundWallet({ userId: 'u', amountUsd: 0 })).rejects.toThrow(BadRequestException);
    await expect(svc.fundWallet({ userId: 'u', amountUsd: NaN })).rejects.toThrow(BadRequestException);
    await expect(svc.setBudget({ userId: 'u', monthlyCapUsd: -1 })).rejects.toThrow(BadRequestException);
    await expect(svc.setBudget({ userId: 'u', monthlyCapUsd: Infinity })).rejects.toThrow(BadRequestException);
    expect(publish).not.toHaveBeenCalled();
  });
});
