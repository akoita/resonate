import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { GenerationService } from './generation.service';
import { Injectable, Logger } from '@nestjs/common';

@Processor('generation', { concurrency: 2 })
@Injectable()
export class GenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerationProcessor.name);

  constructor(private readonly generationService: GenerationService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`[GenerationProcessor] Starting job ${job.id} for user ${job.data.userId}`);
    try {
      await this.generationService.processGenerationJob(job.data);
      this.logger.log(`[GenerationProcessor] Successfully completed job ${job.id}`);
    } catch (error: any) {
      this.logger.error(`[GenerationProcessor] Job ${job.id} failed: ${error?.message || error}`);
      throw error;
    }
  }
}
