export type X402StemQuote = {
  totalAmount: string;
  totalCurrency: string;
  amountUsd: number;
  amountUnits: string;
  payTo: `0x${string}`;
  platformFee: {
    amount: string;
    currency: string;
    feeBps: number;
  };
};

type ParseX402StemQuoteOptions = {
  expectedSymbol: string;
  decimals: number;
  payoutAddress: string;
};

export type X402TransferParams = Pick<X402StemQuote, "amountUnits" | "payTo">;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid x402 quote: ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function decimalUnits(value: unknown, decimals: number, field: string): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`Invalid x402 quote: ${field} must be a plain non-negative decimal string.`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Invalid x402 quote: ${field} exceeds the asset's decimal precision.`);
  }
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}

function matchingCurrency(value: unknown, expectedSymbol: string, field: string): string {
  if (typeof value !== "string" || value.toUpperCase() !== expectedSymbol.toUpperCase()) {
    throw new Error(`Invalid x402 quote: ${field} does not match the configured payment asset.`);
  }
  return value;
}

/**
 * Converts the public stem quote into the only values checkout is allowed to
 * display or transfer. The backend total already includes the platform fee.
 */
export function parseX402StemQuote(
  raw: unknown,
  options: ParseX402StemQuoteOptions,
): X402StemQuote {
  if (!Number.isSafeInteger(options.decimals) || options.decimals < 0 || options.decimals > 255) {
    throw new Error("Invalid x402 configuration: asset decimals are unsupported.");
  }
  if (!EVM_ADDRESS.test(options.payoutAddress) || ZERO_ADDRESS.test(options.payoutAddress)) {
    throw new Error("Invalid x402 configuration: payout address is malformed.");
  }

  const root = record(raw, "response");
  const price = record(root.price, "price");
  const licenseOptions = root.licenseOptions;
  if (!Array.isArray(licenseOptions)) {
    throw new Error("Invalid x402 quote: licenseOptions must be an array.");
  }
  const personalOptions = licenseOptions.filter((entry) => {
    return typeof entry === "object" && entry !== null && !Array.isArray(entry) &&
      (entry as Record<string, unknown>).key === "personal";
  });
  if (personalOptions.length !== 1) {
    throw new Error("Invalid x402 quote: exactly one personal license option is required.");
  }

  const personal = record(personalOptions[0], "personal license option");
  const personalPrice = record(personal.price, "personal price");
  const topCurrency = matchingCurrency(price.currency, options.expectedSymbol, "price.currency");
  const personalCurrency = matchingCurrency(
    personalPrice.currency,
    options.expectedSymbol,
    "personal price.currency",
  );
  const totalUnits = decimalUnits(price.amount, options.decimals, "price.amount");
  const personalUnits = decimalUnits(
    personalPrice.amount,
    options.decimals,
    "personal price.amount",
  );
  if (totalUnits === 0n) {
    throw new Error("Invalid x402 quote: personal total must be greater than zero.");
  }
  if (totalUnits !== personalUnits || topCurrency.toUpperCase() !== personalCurrency.toUpperCase()) {
    throw new Error("Invalid x402 quote: top-level and personal prices do not match.");
  }

  if (typeof price.usd !== "number" || !Number.isFinite(price.usd) || price.usd < 0) {
    throw new Error("Invalid x402 quote: price.usd must be a finite non-negative number.");
  }
  const usdText = String(price.usd);
  if (!DECIMAL.test(usdText) || decimalUnits(usdText, options.decimals, "price.usd") !== totalUnits) {
    throw new Error("Invalid x402 quote: USD display price does not match the personal total.");
  }

  const breakdown = record(personal.breakdown, "personal breakdown");
  if (!Number.isSafeInteger(breakdown.feeBps) || (breakdown.feeBps as number) < 0 || (breakdown.feeBps as number) > 10_000) {
    throw new Error("Invalid x402 quote: feeBps must be an integer between 0 and 10000.");
  }
  const feeBps = breakdown.feeBps as number;
  const platformFee = record(breakdown.platformFee, "platformFee");
  const feeCurrency = matchingCurrency(
    platformFee.currency,
    options.expectedSymbol,
    "platformFee.currency",
  );
  const feeUnits = decimalUnits(platformFee.amount, options.decimals, "platformFee.amount");
  if (feeUnits > totalUnits) {
    throw new Error("Invalid x402 quote: platform fee exceeds the total.");
  }
  if (feeUnits !== totalUnits * BigInt(feeBps) / 10_000n) {
    throw new Error("Invalid x402 quote: platform fee does not match the quoted fee rate.");
  }

  const x402 = record(root.x402, "x402");
  if (x402.scheme !== "exact") {
    throw new Error("Invalid x402 quote: payment scheme must be exact.");
  }
  if (
    typeof x402.payTo !== "string" ||
    !EVM_ADDRESS.test(x402.payTo) ||
    ZERO_ADDRESS.test(x402.payTo)
  ) {
    throw new Error("Invalid x402 quote: payment destination is malformed.");
  }
  if (x402.payTo.toLowerCase() !== options.payoutAddress.toLowerCase()) {
    throw new Error("Invalid x402 quote: payment destination does not match public configuration.");
  }

  return {
    totalAmount: price.amount as string,
    totalCurrency: topCurrency,
    amountUsd: price.usd,
    amountUnits: totalUnits.toString(),
    payTo: x402.payTo as `0x${string}`,
    platformFee: {
      amount: platformFee.amount as string,
      currency: feeCurrency,
      feeBps,
    },
  };
}

/** Fee metadata is deliberately excluded from wallet transfer parameters. */
export function getX402TransferParams(quote: X402StemQuote): X402TransferParams {
  return { amountUnits: quote.amountUnits, payTo: quote.payTo };
}
