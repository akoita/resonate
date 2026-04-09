import { Module } from "@nestjs/common";
import { DmcaController } from "./dmca.controller";
import { DmcaService } from "./dmca.service";
import { RightsModule } from "../rights/rights.module";

@Module({
  imports: [RightsModule],
  controllers: [DmcaController],
  providers: [DmcaService],
  exports: [DmcaService],
})
export class DmcaModule {}
