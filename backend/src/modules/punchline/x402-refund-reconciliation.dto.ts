import { IsOptional, IsString } from "class-validator";

/**
 * `POST /admin/x402-refunds/:id/mark-refunded` (#2362, deferred from #2197).
 * Type only: the service rejects a missing or malformed transaction hash with its
 * own message.
 */
export class MarkX402RefundedDto {
  @IsOptional()
  @IsString()
  refundTxHash?: string;
}
