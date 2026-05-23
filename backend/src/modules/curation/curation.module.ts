import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SharedModule } from "../shared/shared.module";
import { CurationController } from "./curation.controller";
import { CurationService } from "./curation.service";

@Module({
  imports: [SharedModule, AuditModule],
  controllers: [CurationController],
  providers: [CurationService],
})
export class CurationModule {}
