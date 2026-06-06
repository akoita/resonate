import { Module } from "@nestjs/common";
import { CommunityModule } from "../community/community.module";
import { SharedModule } from "../shared/shared.module";
import { RecommendationsController } from "./recommendations.controller";
import { RecommendationsService } from "./recommendations.service";
import { TasteMemoryService } from "./taste_memory.service";

@Module({
  imports: [SharedModule, CommunityModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, TasteMemoryService],
  exports: [RecommendationsService, TasteMemoryService],
})
export class RecommendationsModule {}
