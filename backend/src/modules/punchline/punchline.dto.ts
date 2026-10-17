import { IsOptional, IsString } from "class-validator";

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

  collectorWallet?: string | null;
}
