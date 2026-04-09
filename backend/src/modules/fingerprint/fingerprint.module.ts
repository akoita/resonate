import { Module } from "@nestjs/common";
import { FingerprintController } from "./fingerprint.controller";
import { FingerprintService } from "./fingerprint.service";
import { RightsModule } from "../rights/rights.module";

@Module({
  imports: [RightsModule],
  controllers: [FingerprintController],
  providers: [FingerprintService],
  exports: [FingerprintService],
})
export class FingerprintModule {}
