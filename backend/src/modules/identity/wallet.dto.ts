import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

/**
 * Wallet bodies (#2197). Type checks only: ownership (`assertOwnWalletOrAdmin`),
 * provider names, thresholds and amounts stay with the controller and services.
 * `fund` and `budget` write the number straight into the wallet row, so a string
 * there used to concatenate or fail inside Prisma instead of answering `400`.
 */
export class FundWalletDto {
  @IsString()
  userId!: string;

  @IsNumber()
  amountUsd!: number;
}

export class SetWalletBudgetDto {
  @IsString()
  userId!: string;

  @IsNumber()
  monthlyCapUsd!: number;

  @IsOptional()
  @IsBoolean()
  resetSpent?: boolean;
}

export class SetWalletProviderDto {
  @IsString()
  userId!: string;

  @IsString()
  provider!: "local" | "erc4337";
}

export class RefreshWalletDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  provider?: "local" | "erc4337";
}

export class ConfigurePaymasterDto {
  @IsNumber()
  sponsorMaxUsd!: number;

  @IsString()
  paymasterAddress!: string;
}

export class ResetPaymasterDto {
  @IsString()
  userId!: string;
}

export class CreateSessionKeyDto {
  @IsString()
  userId!: string;

  @IsString()
  scope!: string;

  @IsNumber()
  ttlSeconds!: number;
}

export class ValidateSessionKeyDto {
  @IsString()
  token!: string;

  @IsString()
  scope!: string;
}

export class SetGuardiansDto {
  @IsString()
  userId!: string;

  @IsArray()
  @IsString({ each: true })
  guardians!: string[];

  @IsNumber()
  required!: number;
}

export class RequestRecoveryDto {
  @IsString()
  userId!: string;

  @IsString()
  newOwner!: string;

  @IsNumber()
  required!: number;
}

export class ApproveRecoveryDto {
  @IsString()
  requestId!: string;

  @IsString()
  guardian!: string;
}

export class AgentWalletPermissionsDto {
  @IsString()
  target!: string;

  @IsString()
  function!: string;

  @IsString()
  totalCapWei!: string;

  @IsString()
  perTxCapWei!: string;

  @IsNumber()
  rateLimit!: number;
}

export class EnableAgentWalletDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AgentWalletPermissionsDto)
  permissions?: AgentWalletPermissionsDto;

  @IsOptional()
  @IsNumber()
  validityHours?: number;
}

export class ActivateAgentSessionKeyDto {
  @IsString()
  approvalData!: string;

  @IsOptional()
  @IsString()
  txHash?: string;
}

export class DisableAgentWalletDto {
  @IsOptional()
  @IsString()
  revokeTxHash?: string;
}

export class RotateAgentKeyDto {
  /** Read as given by the session key service. */
  @IsOptional()
  @IsObject()
  permissions?: any;

  @IsOptional()
  @IsNumber()
  validityHours?: number;
}

/**
 * `listingId`, `tokenId`, `amount` and `totalPriceWei` stay undecorated: they
 * are read with `BigInt()`, which accepts a number as well as a string.
 */
export class AgentPurchaseDto {
  @IsString()
  sessionId!: string;

  listingId!: string;
  tokenId!: string;
  amount!: string;
  totalPriceWei!: string;

  @IsNumber()
  priceUsd!: number;
}
