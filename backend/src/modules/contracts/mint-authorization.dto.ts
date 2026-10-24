import { IsArray, IsOptional } from "class-validator";
import type { MintAuthorizationInput } from "./mint-authorization.service";

/**
 * Body of `POST /contracts/mint-authorizations/batch` (#2197). Each entry is
 * read by `MintAuthorizationService`, which parses the stem id, the addresses
 * and the amounts (those take strings or numbers), so only the list itself is
 * checked here. A missing list stays an empty batch, as before.
 */
export class MintAuthorizationBatchDto {
  @IsOptional()
  @IsArray()
  authorizations?: MintAuthorizationInput[];
}
