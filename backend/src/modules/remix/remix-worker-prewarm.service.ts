import { Injectable, Logger } from "@nestjs/common";
import { fetch as undiciFetch } from "undici";
import {
  AudioWorkerIdentityTokenMinter,
  isAudioConditionedRemixGenerationActiveAndEnabled,
  readAudioConditionedWorkerConfig,
} from "./audio-conditioned-remix-generation.provider";

const DEFAULT_PREWARM_TTL_SECONDS = 600;
const PREWARM_TIMEOUT_MS = 5_000;

@Injectable()
export class RemixWorkerPrewarmService {
  private readonly logger = new Logger(RemixWorkerPrewarmService.name);
  private readonly idTokenMinter = new AudioWorkerIdentityTokenMinter(
    this.logger,
  );
  private inFlight: Promise<void> | null = null;
  private lastAttemptAtMs = 0;

  prewarm(): void {
    if (!isAudioConditionedRemixGenerationActiveAndEnabled()) {
      this.logger.debug("Skipping remix worker prewarm: provider inactive.");
      return;
    }
    if (this.inFlight) {
      this.logger.debug("Skipping remix worker prewarm: already in flight.");
      return;
    }

    const now = Date.now();
    const ttlMs = readPrewarmTtlSeconds() * 1_000;
    if (now - this.lastAttemptAtMs < ttlMs) {
      this.logger.debug("Skipping remix worker prewarm: debounce TTL active.");
      return;
    }

    this.lastAttemptAtMs = now;
    this.inFlight = this.callWorkerHealth().finally(() => {
      this.inFlight = null;
    });
  }

  private async callWorkerHealth(): Promise<void> {
    try {
      const config = readAudioConditionedWorkerConfig();
      const headers: Record<string, string> = {};
      const idToken = await this.idTokenMinter.mint(config.workerUrl);
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
      }

      const response = await undiciFetch(`${config.workerUrl}/health`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.debug(
          `Remix worker prewarm health returned ${response.status}.`,
        );
      }
    } catch (error) {
      if (isAbortError(error)) {
        this.logger.debug("Remix worker prewarm timed out after startup ping.");
        return;
      }
      this.logger.warn(
        `Remix worker prewarm failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function readPrewarmTtlSeconds(): number {
  const raw = process.env.REMIX_WORKER_PREWARM_TTL_SECONDS;
  if (raw === undefined) {
    return DEFAULT_PREWARM_TTL_SECONDS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PREWARM_TTL_SECONDS;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
