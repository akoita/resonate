import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { IngestionController } from "./ingestion.controller";
import { IngestionService } from "./ingestion.service";

@Module({
  controllers: [IngestionController],
  providers: [EventBus, IngestionService],
})
export class IngestionModule {}
