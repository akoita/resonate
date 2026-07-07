import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * Operator/promo grant request (#1334). Credits are USD cents; the operator
 * seeds a user's meter on staging. The upper bound keeps a fat-fingered grant
 * from minting an absurd balance ($100,000 cap).
 */
export class GrantCreditsDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reason!: string;
}
