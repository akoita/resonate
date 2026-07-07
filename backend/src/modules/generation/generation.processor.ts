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
      const result = await this.generationService.processGenerationJob(job.data);
      this.logger.log(`[GenerationProcessor] Successfully completed job ${job.id}`);
      return result;
    } catch (error: any) {
      this.logger.error(`[GenerationProcessor] Job ${job.id} failed: ${error?.message || error}`);
      // #1334: only refund the debited credits once the job has terminally
      // failed (all retries exhausted). Retryable attempts keep the charge so a
      // transient failure that later succeeds is not double-refunded. The refund
      // itself is idempotent per jobId, so a re-delivery is safe too.
      const maxAttempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        await this.generationService.refundFailedGenerationJob(job.data);
      }
      throw error;
    }
  }
}
