import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { CurationController } from "./curation.controller";
import { CurationService } from "./curation.service";

@Module({
  controllers: [CurationController],
  providers: [EventBus, CurationService],
})
export class CurationModule {}
