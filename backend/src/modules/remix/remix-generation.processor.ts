import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import {
  REMIX_GENERATION_QUEUE,
  RemixProjectService,
  type RemixGenerationJobData,
} from "./remix-project.service";

@Processor(REMIX_GENERATION_QUEUE, { concurrency: 2 })
@Injectable()
export class RemixGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(RemixGenerationProcessor.name);

  constructor(private readonly projectService: RemixProjectService) {
    super();
  }

  async process(job: Job<RemixGenerationJobData, any, string>): Promise<any> {
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
