import { Module } from "@nestjs/common";
import { PreviewMeasuresController } from "./preview_measures.controller";
import { PreviewMeasuresService } from "./preview_measures.service";

/** Preview measures (#2670). */
@Module({
  controllers: [PreviewMeasuresController],
  providers: [PreviewMeasuresService],
})
export class PreviewMeasuresModule {}
