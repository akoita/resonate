import { Module } from "@nestjs/common";
import { AdminUsersController } from "./admin_users.controller";
import { AdminUsersService } from "./admin_users.service";

/** Operator users directory and detail (#2166). Read-only; depends only on the database. */
@Module({
  controllers: [AdminUsersController],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminUsersModule {}
