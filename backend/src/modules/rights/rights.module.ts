import { Module } from "@nestjs/common";
import { UploadRightsRoutingService } from "./upload-rights-routing.service";

@Module({
  providers: [UploadRightsRoutingService],
  exports: [UploadRightsRoutingService],
})
export class RightsModule {}
