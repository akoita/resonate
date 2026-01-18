import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EventBus } from "../shared/event_bus";
import { CurationController } from "./curation.controller";
import { CurationService } from "./curation.service";

@Module({
  imports: [AuditModule],
  controllers: [CurationController],
  providers: [EventBus, CurationService],
})
export class CurationModule {}
