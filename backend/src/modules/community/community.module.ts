import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { CommunityController } from "./community.controller";
import { CommunityEligibilityService } from "./community_eligibility.service";
import { CommunityService } from "./community.service";

@Module({
  imports: [SharedModule],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityEligibilityService],
  exports: [CommunityService, CommunityEligibilityService],
})
export class CommunityModule {}
