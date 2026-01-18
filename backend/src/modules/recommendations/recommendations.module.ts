import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";

@Module({
  controllers: [RecommendationsController],
  providers: [EventBus, RecommendationsService],
})
export class RecommendationsModule {}
