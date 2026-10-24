import { IsArray, IsObject, IsOptional, IsString } from "class-validator";

/**
 * Encryption bodies (#2197). Type checks only. The handlers answer a missing
 * `uri`, `authSig`, `stemId` or `walletAddress` with their own `400`, so those
 * stay optional here and keep that answer; a field that is sent must have the
 * right type.
 */
export class DecryptRequestDto {
  @IsOptional()
  @IsString()
  uri?: string;

  @IsOptional()
  @IsString()
  metadata?: string;

  @IsOptional()
  @IsString()
  dataToEncryptHash?: string;

  @IsOptional()
  @IsArray()
  accessControlConditions?: any[];

  /** `{ address, sig, signedMessage }`; the handler binds `address` to the caller. */
  @IsOptional()
  @IsObject()
  authSig?: any;
}

export class DownloadRequestDto {
  @IsOptional()
  @IsString()
  stemId?: string;

  @IsOptional()
  @IsString()
  walletAddress?: string;
}
