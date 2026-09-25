import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * Local-dev wallet funding (#1890). The service still checks the address format
 * and restricts funding to local chains; the DTO rejects malformed bodies (e.g. a
 * non-numeric amount that would otherwise surface as a 500 from `parseUnits`).
 */
export class FundLocalDevWalletDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  wallet!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  assetId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,18})?$/, { message: "amount must be a positive decimal string" })
  amount?: string;
}
