import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Roles } from "../auth/roles.decorator";
import { ListAdminUsersQueryDto } from "./admin_users.dto";
import { AdminUsersService } from "./admin_users.service";

/**
 * Operator users directory, overview and detail (#2166).
 *
 * Read-only and open to `admin` and `operator`. Restricting or closing an
 * account stays on the admin-only `/admin/accounts/*` routes (#2147); the
 * global `RolesGuard` enforces `@Roles` here (it authenticates the JWT itself).
 * `overview` is declared before `:id` so it is not read as a user id.
 */
@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Get("overview")
  overview() {
    return this.users.overview();
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Get()
  list(@Query() query: ListAdminUsersQueryDto) {
    return this.users.list(query);
  }

  @UseGuards(AuthGuard("jwt"))
  @Roles("admin", "operator")
  @Get(":id")
  detail(@Req() req: any, @Param("id") id: string) {
    return this.users.detail(req.user.userId as string, id);
  }
}
