/**
 * Pure notification-copy helpers (#1885): cents formatting and the
 * user-id → notification inbox mapping.
 */
import {
  formatUsdCents,
  notifiableWalletForUserId,
} from "../modules/notifications/notification_format";

describe("formatUsdCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [50, "$0.50"],
    [100, "$1.00"],
    [1234, "$12.34"],
    [100_000, "$1,000.00"],
    [10_000_000, "$100,000.00"],
  ])("formats %d cents as %s", (cents, expected) => {
    expect(formatUsdCents(cents)).toBe(expected);
  });

  it("formats a negative amount with a leading minus", () => {
    expect(formatUsdCents(-250)).toBe("-$2.50");
  });

  it("never renders a float artifact or NaN", () => {
    expect(formatUsdCents(12.9)).toBe("$0.12");
    expect(formatUsdCents(Number.NaN)).toBe("$0.00");
  });
});

describe("notifiableWalletForUserId", () => {
  const address = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

  it("maps a wallet-address user id to its lower-cased inbox key", () => {
    expect(notifiableWalletForUserId(address)).toBe(address.toLowerCase());
  });

  it("returns null for ids that are not wallet addresses", () => {
    expect(notifiableWalletForUserId("user-1")).toBeNull();
    expect(notifiableWalletForUserId("0x1234")).toBeNull();
    expect(notifiableWalletForUserId("")).toBeNull();
    expect(notifiableWalletForUserId(undefined)).toBeNull();
  });
});
