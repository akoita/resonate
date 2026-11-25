import { Module } from "@nestjs/common";
import { CompositionController } from "./composition.controller";
import { CompositionService } from "./composition.service";

/** Composition details per track and the usage export (#2669). */
@Module({
  controllers: [CompositionController],
  providers: [CompositionService],
  exports: [CompositionService],
})
export class CompositionModule {}
