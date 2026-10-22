import { IsOptional, IsString, Matches } from "class-validator";
import { PAYMENT_BINDING_SIGNATURE_PATTERN } from "../x402/x402.payer-binding";

/**
 * Punchline bodies whose services did not type-check every field (#1890).
 * The drop service still reports a missing `trackId` and bounds the text, and
 * the x402 service still returns its coded `invalid_tx_hash` / `invalid_payer`
 * errors for a malformed string; these only reject non-string values.
 */
export class CreateDropDto {
  @IsOptional()
  @IsString()
  trackId?: string;

  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;
}

/** `collectorWallet` stays undecorated: the service maps any value to a wallet or null. */
export class SmartAccountCollectDto {
  @IsOptional()
  @IsString()
  txHash?: string;

  @IsOptional()
  @IsString()
  payer?: string;

  /** Proves a payer that is not one of the buyer's own addresses (`x402.payer-binding`). */
  @IsOptional()
  @IsString()
  @Matches(PAYMENT_BINDING_SIGNATURE_PATTERN)
  payerSignature?: string;

  collectorWallet?: string | null;
}
