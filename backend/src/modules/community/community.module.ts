import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { CommunityController } from "./community.controller";
import { CommunityEligibilityService } from "./community_eligibility.service";
import { CommunityRoomsService } from "./community_rooms.service";
import { CommunityService } from "./community.service";

@Module({
  imports: [SharedModule],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityEligibilityService, CommunityRoomsService],
  exports: [CommunityService, CommunityEligibilityService, CommunityRoomsService],
})
export class CommunityModule {}
