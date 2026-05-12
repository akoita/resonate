import { Module } from "@nestjs/common";
import { RightsRouteReassessmentService } from "./rights-route-reassessment.service";
import { TrustedSourceService } from "./trusted-source.service";
import { UploadRightsRoutingService } from "./upload-rights-routing.service";

@Module({
  providers: [
    RightsRouteReassessmentService,
    TrustedSourceService,
    UploadRightsRoutingService,
  ],
  exports: [
    RightsRouteReassessmentService,
    TrustedSourceService,
    UploadRightsRoutingService,
  ],
})
export class RightsModule {}
