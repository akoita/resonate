import { Module } from "@nestjs/common";
import { DmcaController } from "./dmca.controller";
import { DmcaService } from "./dmca.service";

@Module({
  controllers: [DmcaController],
  providers: [DmcaService],
  exports: [DmcaService],
})
export class DmcaModule {}
