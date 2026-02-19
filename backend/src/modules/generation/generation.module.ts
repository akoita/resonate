import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CatalogModule } from '../catalog/catalog.module';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { GenerationProcessor } from './generation.processor';
import { LyriaClient } from './lyria.client';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'generation',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    CatalogModule,
  ],
  controllers: [GenerationController],
  providers: [GenerationService, GenerationProcessor, LyriaClient],
  exports: [GenerationService],
})
export class GenerationModule {}
