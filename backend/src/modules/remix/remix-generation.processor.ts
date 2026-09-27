import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import {
  REMIX_GENERATION_QUEUE,
  RemixProjectService,
  type RemixGenerationJobData,
  type RemixPartTakeJobData,
} from "./remix-project.service";
import { REMIX_PART_TAKE_JOB } from "./remix-parts";

@Processor(REMIX_GENERATION_QUEUE, { concurrency: 2 })
@Injectable()
export class RemixGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(RemixGenerationProcessor.name);

  constructor(private readonly projectService: RemixProjectService) {
    super();
  }

  async process(
    job: Job<RemixGenerationJobData | RemixPartTakeJobData, any, string>,
  ): Promise<any> {
    // AI part takes (#1901) share the queue; dispatch on the job name.
    if (job.name === REMIX_PART_TAKE_JOB) {
      const data = job.data as RemixPartTakeJobData;
      this.logger.log(
        `[RemixGenerationProcessor] Starting part take ${data.takeId} for project ${data.projectId}`,
      );
      try {
        const result = await this.projectService.processPartTakeJob(data);
        this.logger.log(
          `[RemixGenerationProcessor] Settled part take ${data.takeId}: ${JSON.stringify(result)}`,
        );
        return result;
      } catch (error) {
        this.logger.error(
          `[RemixGenerationProcessor] Part take ${data.takeId} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    }
    return this.processDraft(job as Job<RemixGenerationJobData, any, string>);
  }

  private async processDraft(
    job: Job<RemixGenerationJobData, any, string>,
  ): Promise<any> {
    this.logger.log(
      `[RemixGenerationProcessor] Starting job ${job.id} for project ${job.data.projectId}`,
    );
    try {
      const result = await this.projectService.processGenerationJob(job.data);
      this.logger.log(
        `[RemixGenerationProcessor] Completed job ${job.id} for project ${job.data.projectId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `[RemixGenerationProcessor] Job ${job.id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
