import { IsOptional, IsString } from "class-validator";

/**
 * POST /privacy/account/closure (#2197). Type checks only: the step-up service
 * verifies the signature and the closure service bounds the reason.
 */
export class AccountClosureRequestDto {
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
