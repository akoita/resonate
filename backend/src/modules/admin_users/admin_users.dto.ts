import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export const ADMIN_USER_STATUSES = ["active", "suspended", "closed"] as const;
export const ADMIN_USER_ROLE_FILTERS = ["admin", "operator", "agent", "artist", "listener"] as const;
export const ADMIN_USER_SORTS = ["createdAt", "lastActiveAt", "lastSignInAt"] as const;
export const ADMIN_USER_ORDERS = ["asc", "desc"] as const;

export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];
export type AdminUserRoleFilter = (typeof ADMIN_USER_ROLE_FILTERS)[number];
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];
export type AdminUserOrder = (typeof ADMIN_USER_ORDERS)[number];

export const ADMIN_USERS_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_USERS_MAX_PAGE_SIZE = 100;

// The global validation pipe does not transform (`transform: false`), so query
// values reach the handler as the strings they arrived as. These transforms only
// shape the instance that is validated; the service parses the raw strings again.
const toNumber = ({ value }: { value: unknown }) =>
  value === undefined || value === null ? value : Number(value);
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** Query for `GET /admin/users` (#2166). */
export class ListAdminUsersQueryDto {
  /** Exact user id, wallet or owner address prefix, or artist name contains. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  q?: string;

  @IsOptional()
  @IsIn([...ADMIN_USER_STATUSES])
  status?: string;

  @IsOptional()
  @IsIn([...ADMIN_USER_ROLE_FILTERS])
  role?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(365)
  activeWithinDays?: number | string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(365)
  inactiveForDays?: number | string;

  @IsOptional()
  @IsIn([...ADMIN_USER_SORTS])
  sort?: string;

  @IsOptional()
  @IsIn([...ADMIN_USER_ORDERS])
  order?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number | string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(ADMIN_USERS_MAX_PAGE_SIZE)
  pageSize?: number | string;
}
