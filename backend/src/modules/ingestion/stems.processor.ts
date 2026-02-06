import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { IngestionService } from "./ingestion.service";
import { Injectable, Logger } from "@nestjs/common";

@Processor("stems", { concurrency: 1 })
@Injectable()
export class StemsProcessor extends WorkerHost {
    private readonly logger = new Logger(StemsProcessor.name);

    constructor(private readonly ingestionService: IngestionService) {
        super();
    }

    async process(job: Job<any, any, string>): Promise<any> {
        this.logger.log(`[StemsProcessor] Starting job ${job.id} for release ${job.data.releaseId}`);
        try {
            await this.ingestionService.processStemsJob(job.data);
            this.logger.log(`[StemsProcessor] Successfully completed job ${job.id}`);
        } catch (error: any) {
            this.logger.error(`[StemsProcessor] Job ${job.id} failed: ${error?.message || error}`);
            throw error;
        }
    }
}
