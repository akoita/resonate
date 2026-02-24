import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CatalogModule } from '../catalog/catalog.module';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { GenerationProcessor } from './generation.processor';
import { LyriaClient } from './lyria.client';
import { LyriaRealtimeService } from './lyria_realtime.service';
import { SynthIdService } from './synthid.service';
import { SynthIdController } from './synthid.controller';

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
  controllers: [GenerationController, SynthIdController],
  providers: [GenerationService, GenerationProcessor, LyriaClient, LyriaRealtimeService, SynthIdService],
  exports: [GenerationService, LyriaRealtimeService, SynthIdService],
})
export class GenerationModule {}

