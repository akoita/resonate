import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { CommunityController } from "./community.controller";
import { CommunityCohortGenerationService } from "./community_cohort_generation.service";
import { CommunityCohortQualityService } from "./community_cohort_quality.service";
import { CommunityCohortService } from "./community_cohort.service";
import { CommunityEligibilityService } from "./community_eligibility.service";
import { CommunityModerationAssistService } from "./community_moderation_assist.service";
import { CommunityRoomsService } from "./community_rooms.service";
import { CommunityService } from "./community.service";

@Module({
  imports: [SharedModule],
  controllers: [CommunityController],
  providers: [
    CommunityService,
    CommunityEligibilityService,
    CommunityRoomsService,
    CommunityModerationAssistService,
    CommunityCohortService,
    CommunityCohortGenerationService,
    CommunityCohortQualityService,
  ],
  exports: [
    CommunityService,
    CommunityEligibilityService,
    CommunityRoomsService,
    CommunityModerationAssistService,
    CommunityCohortService,
    CommunityCohortGenerationService,
    CommunityCohortQualityService,
  ],
})
export class CommunityModule {}
