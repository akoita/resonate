import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { CommunityController } from "./community.controller";
import { CommunityCohortGenerationService } from "./community_cohort_generation.service";
import { CommunityCohortService } from "./community_cohort.service";
import { CommunityEligibilityService } from "./community_eligibility.service";
import { CommunityRoomsService } from "./community_rooms.service";
import { CommunityService } from "./community.service";

@Module({
  imports: [SharedModule],
  controllers: [CommunityController],
  providers: [
    CommunityService,
    CommunityEligibilityService,
    CommunityRoomsService,
    CommunityCohortService,
    CommunityCohortGenerationService,
  ],
  exports: [
    CommunityService,
    CommunityEligibilityService,
    CommunityRoomsService,
    CommunityCohortService,
    CommunityCohortGenerationService,
  ],
})
export class CommunityModule {}
