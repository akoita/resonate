import { Transform } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_OUTCOMES } from "./admin_audit_event";

export const ADMIN_AUDIT_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_AUDIT_MAX_PAGE_SIZE = 100;

// The global validation pipe does not transform, so query values arrive as strings.
const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === null ? value : Number(value);
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** Query for `GET /admin/audit-events` (#2173). */
export class ListAdminAuditEventsQueryDto {
  @IsOptional()
  @IsIn([...ADMIN_AUDIT_ACTIONS])
  action?: string;

  @IsOptional()
  @IsIn([...ADMIN_AUDIT_OUTCOMES])
  outcome?: string;

  /** Exact id of the operator who acted. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  actor?: string;

  /** Exact id of the account that was viewed or acted on. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  target?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number | string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(ADMIN_AUDIT_MAX_PAGE_SIZE)
  pageSize?: number | string;
}
