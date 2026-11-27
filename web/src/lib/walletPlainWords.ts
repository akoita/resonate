import type { PaymentAssetBalance } from "../hooks/usePaymentAssets";
import { formatDollars as formatSharedDollars } from "./money";

/**
 * Plain words for the wallet (newcomer pass): money is shown in dollars, test
 * networks say so, and no screen needs "smart account", "gas" or "ETH" to make
 * sense. The technical names stay under the Wallet page's details.
 */

/** Test networks the app runs on outside production. */
const TEST_CHAIN_IDS = new Set([84532, 11155111, 31337]);

export function isTestMoneyChain(chainId: number | null | undefined) {
  return chainId != null && TEST_CHAIN_IDS.has(chainId);
}

/** Circle's public test-USDC faucet and the network name it lists, per test chain. */
const TEST_DOLLAR_FAUCETS: Record<number, string> = {
  84532: "Base Sepolia",
  11155111: "Ethereum Sepolia",
};

export function testDollarFaucet(chainId: number | null | undefined) {
  const networkName = chainId != null ? TEST_DOLLAR_FAUCETS[chainId] : undefined;
  return networkName ? { url: "https://faucet.circle.com/", networkName } : null;
}

/** Dollar-pegged balances (USDC) added up, in dollars. */
export function dollarBalance(balances: PaymentAssetBalance[]): number {
  return balances
    .filter(({ asset }) => asset.kind === "stablecoin")
    .reduce((total, { asset, balanceUnits }) => total + Number(balanceUnits) / 10 ** asset.decimals, 0);
}

/** The wallet balance in the shared checkout format (#2724). */
export function formatDollars(amount: number) {
  return formatSharedDollars(amount);
}

/** "$20" for a whole amount, "$2.50" otherwise. */
export function formatWelcomeDollars(amount: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `$${amount}`;
  return Number.isInteger(value) ? `$${value}` : formatDollars(value);
}

export function welcomeMoneyMessage(input: { amountUsdc?: string | null; amountEth?: string | null }) {
  if (input.amountUsdc) {
    return `You have ${formatWelcomeDollars(input.amountUsdc)} of test money to try Resonate, for example to back a show. It isn't real money, so nothing you do with it costs you anything.`;
  }
  return "We covered the small fees your first actions need. It's test money, so nothing you do with it costs you anything.";
}

/**
 * What the line under the balance says about fees. A wallet needs a little ETH
 * for network fees unless the deployment pays them (sponsored).
 */
export function feesLine(input: { sponsored: boolean; ethBalance: number | null }) {
  if (input.sponsored) return "Fees are on us.";
  if (input.ethBalance == null) return null;
  if (input.ethBalance <= 0) return "No fee money yet. Your welcome money covers it.";
  return "Fee money is ready for your next actions.";
}
