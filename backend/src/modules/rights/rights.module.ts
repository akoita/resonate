import { Module } from "@nestjs/common";
import { TrustedSourceService } from "./trusted-source.service";
import { UploadRightsRoutingService } from "./upload-rights-routing.service";

@Module({
  providers: [TrustedSourceService, UploadRightsRoutingService],
  exports: [TrustedSourceService, UploadRightsRoutingService],
})
export class RightsModule {}
