import { Module } from "@nestjs/common";
import { AdminAuditController } from "./admin_audit.controller";
import { AdminAuditService } from "./admin_audit.service";

/** The admin audit log's read side (#2173). The writer is `writeAdminAuditEvent`. */
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
