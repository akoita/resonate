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
      //
      // #1778: `attemptsMade` counts attempts that have ALREADY failed. BullMQ
      // v5 moved the increment to after a job completes or fails (introducing
      // `attemptsStarted` for the old meaning), so inside this catch the attempt
      // currently failing is not counted yet: on the last of three attempts
      // `attemptsMade` is 2, not 3. Comparing it directly against the limit was
      // therefore false on every attempt and no terminal failure ever refunded.
      // Count the in-flight attempt explicitly. If this ever needs revisiting,
      // the spec asserts the whole attempt sequence rather than one value.
      const maxAttempts = job.opts?.attempts ?? 1;
      const attemptsFailedIncludingThisOne = job.attemptsMade + 1;
      if (attemptsFailedIncludingThisOne >= maxAttempts) {
        await this.generationService.refundFailedGenerationJob(job.data);
      }
      throw error;
    }
  }
}
