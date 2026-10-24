import { IsNumber, IsOptional, IsString } from "class-validator";
import type { AuthMode } from "./signup_faucet.service";

/**
 * Sign-in bodies (#2197). Type checks only: unknown fields pass through, and
 * the controller keeps the signature, nonce and chain checks. The verify route
 * answers every failure with a 200 `{ status }` body, so these only turn a
 * wrong-typed field into a `400` before any signature work starts.
 */
export class AuthNonceDto {
  @IsString()
  address!: string;
}

export class AuthVerifyDto {
  @IsString()
  address!: string;

  @IsString()
  message!: string;

  @IsString()
  signature!: `0x${string}`;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  authMode?: AuthMode;

  @IsOptional()
  @IsNumber()
  chainId?: number;

  /** Local dev (31337): EOA that signed; we verify this and issue the token for `address`. */
  @IsOptional()
  @IsString()
  signerAddress?: string;

  /** P-256 public key coordinates for passkey identity continuity. */
  @IsOptional()
  @IsString()
  pubKeyX?: string;

  @IsOptional()
  @IsString()
  pubKeyY?: string;
}
