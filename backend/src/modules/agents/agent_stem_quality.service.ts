import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { CatalogService } from "../catalog/catalog.service";
import { AgentIdentityService } from "./agent_identity.service";
import {
  STEM_QUALITY_TASK_TYPE,
  analyzeStemQuality,
  buildStemQualityMetadataKey,
  buildStemQualityRatingPayload,
  computeCuratorReputationDelta,
  computeStemQualityTaskHash,
  rankListingsByQuality,
  type QualityRankedListing,
  type QualityRatingSummary,
  type StemQualityRatingPayload,
} from "./stem_quality";
import { toDataUriJson } from "./erc8004_identity";

export type StemQualityRatingView = {
  id: string;
  stemId: string;
  curatorUserId: string;
  curatorAgentConfigId: string | null;
  curatorIdentityRegistry: string | null;
  curatorIdentityTokenId: string | null;
  score: number;
  metrics: {
    rmsEnergy: number;
    spectralDensity: number;
    silenceRatio: number;
    musicalSalience: number;
  };
  confidence: number;
  taskType: string;
  analysisMethod: string;
  analysisUri: string | null;
  onchainMetadataKey: string | null;
  onchainTaskHash: string | null;
  onchainTxHash: string | null;
  onchainStatus: string;
  onchainError: string | null;
  purchaseValidationCount: number;
  skipValidationCount: number;
  reputationDelta: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class AgentStemQualityService {
  private readonly logger = new Logger(AgentStemQualityService.name);

  constructor(
    private readonly catalogService: CatalogService,
    private readonly identityService: AgentIdentityService,
  ) {}

  async analyzeStem(input: { userId: string; stemId: string }): Promise<StemQualityRatingView> {
    const config = await prisma.agentConfig.findUnique({ where: { userId: input.userId } });
    if (!config) {
      throw new BadRequestException("Agent config is required before publishing stem quality ratings");
    }

    const stem = await prisma.stem.findUnique({
      where: { id: input.stemId },
      include: {
        nftMint: true,
      },
    });
    if (!stem) {
      throw new NotFoundException("Stem not found");
    }

    const blob = await this.catalogService.getStemBlob(input.stemId, { includeRestricted: true });
    if (!blob?.data?.length) {
      throw new BadRequestException("Stem audio is not available for quality analysis");
    }

    const analysis = analyzeStemQuality({
      stemId: stem.id,
      tokenId: stem.nftMint?.tokenId ?? null,
      stemType: stem.type,
      audio: blob.data,
    });
    const analysisUri = toDataUriJson(analysis);
    const payload = buildStemQualityRatingPayload({
      analysis,
      curatorUserId: input.userId,
      curatorAgentConfigId: config.id,
      curatorIdentityRegistry: config.identityRegistry,
      curatorIdentityTokenId: config.identityTokenId,
      analysisUri,
    });
    const taskHash = computeStemQualityTaskHash(payload);
    const metadataKey = buildStemQualityMetadataKey(taskHash);

    let rating = await prisma.stemQualityRating.upsert({
      where: {
        stemId_curatorUserId: {
          stemId: stem.id,
          curatorUserId: input.userId,
        },
      },
      update: this.ratingData({
        config,
        analysis,
        payload,
        analysisUri,
        taskHash,
        metadataKey,
        onchainStatus: "local",
        onchainTxHash: null,
        onchainError: null,
      }),
      create: {
        stemId: stem.id,
        curatorUserId: input.userId,
        ...this.ratingData({
          config,
          analysis,
          payload,
          analysisUri,
          taskHash,
          metadataKey,
          onchainStatus: "local",
          onchainTxHash: null,
          onchainError: null,
        }),
      },
    });

    try {
      const onchain = await this.identityService.publishMetadata(input.userId, metadataKey, payload);
      rating = await prisma.stemQualityRating.update({
        where: { id: rating.id },
        data: {
          onchainStatus: onchain.txHash ? "attested" : onchain.reason ?? "local",
          onchainTxHash: onchain.txHash,
          onchainError: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ERC-8004 stem quality publication failed for ${stem.id}: ${message}`);
      rating = await prisma.stemQualityRating.update({
        where: { id: rating.id },
        data: {
          onchainStatus: "failed",
          onchainError: message,
        },
      });
    }

    return this.toView(rating);
  }

  async getStemRatings(stemId: string): Promise<StemQualityRatingView[]> {
    const ratings = await prisma.stemQualityRating.findMany({
      where: { stemId },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    });
    return ratings.map((rating) => this.toView(rating));
  }

  async rankListings<T extends { tokenId: bigint; stemType: string }>(
    listings: T[],
    options: { minScore?: number } = {},
  ): Promise<Array<QualityRankedListing<T>>> {
    if (listings.length === 0) return [];
    const tokenIds = Array.from(new Set(listings.map((listing) => listing.tokenId.toString())));
    const ratings = await prisma.stemQualityRating.findMany({
      where: {
        stem: {
          nftMint: {
            is: {
              tokenId: { in: tokenIds.map((tokenId) => BigInt(tokenId)) },
            },
          },
        },
      },
      include: {
        stem: {
          include: { nftMint: true },
        },
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    });

    const summaries: QualityRatingSummary[] = ratings
      .filter((rating) => rating.stem.nftMint)
      .map((rating) => ({
        id: rating.id,
        tokenId: rating.stem.nftMint!.tokenId,
        score: rating.score,
        confidence: rating.confidence,
        purchaseValidationCount: rating.purchaseValidationCount,
        skipValidationCount: rating.skipValidationCount,
        reputationDelta: rating.reputationDelta,
      }));

    return rankListingsByQuality(listings, summaries, options);
  }

  async recordValidation(input: {
    stemId: string;
    validation: "purchase" | "skip";
  }): Promise<void> {
    const ratings = await prisma.stemQualityRating.findMany({
      where: { stemId: input.stemId },
    });
    if (ratings.length === 0) return;

    const touchedCurators = new Set<string>();
    for (const rating of ratings) {
      const delta = computeCuratorReputationDelta({
        score: rating.score,
        validation: input.validation,
      });
      await prisma.stemQualityRating.update({
        where: { id: rating.id },
        data: {
          ...(input.validation === "purchase"
            ? { purchaseValidationCount: { increment: 1 } }
            : { skipValidationCount: { increment: 1 } }),
          reputationDelta: { increment: delta },
          lastValidatedAt: new Date(),
        },
      });
      touchedCurators.add(rating.curatorUserId);
    }

    for (const curatorUserId of touchedCurators) {
      const config = await prisma.agentConfig.findUnique({ where: { userId: curatorUserId } });
      if (config) {
        await this.identityService.enrichConfig(config).catch((error) => {
          this.logger.warn(`Failed to refresh curator reputation for ${curatorUserId}: ${error}`);
        });
      }
    }
  }

  private ratingData(input: {
    config: {
      id: string;
      identityRegistry: string | null;
      identityTokenId: string | null;
    };
    analysis: ReturnType<typeof analyzeStemQuality>;
    payload: StemQualityRatingPayload;
    analysisUri: string;
    taskHash: string;
    metadataKey: string;
    onchainStatus: string;
    onchainTxHash: string | null;
    onchainError: string | null;
  }): Omit<Prisma.StemQualityRatingUncheckedCreateInput, "stemId" | "curatorUserId"> {
    return {
      curatorAgentConfigId: input.config.id,
      curatorIdentityRegistry: input.config.identityRegistry,
      curatorIdentityTokenId: input.config.identityTokenId,
      score: input.analysis.score,
      rmsEnergy: input.analysis.metrics.rmsEnergy,
      spectralDensity: input.analysis.metrics.spectralDensity,
      silenceRatio: input.analysis.metrics.silenceRatio,
      musicalSalience: input.analysis.metrics.musicalSalience,
      confidence: input.analysis.confidence,
      taskType: STEM_QUALITY_TASK_TYPE,
      analysisMethod: input.analysis.analysisMethod,
      analysisMetadata: input.payload as Prisma.InputJsonObject,
      analysisUri: input.analysisUri,
      onchainMetadataKey: input.metadataKey,
      onchainTaskHash: input.taskHash,
      onchainTxHash: input.onchainTxHash,
      onchainStatus: input.onchainStatus,
      onchainError: input.onchainError,
    };
  }

  private toView(rating: {
    id: string;
    stemId: string;
    curatorUserId: string;
    curatorAgentConfigId: string | null;
    curatorIdentityRegistry: string | null;
    curatorIdentityTokenId: string | null;
    score: number;
    rmsEnergy: number;
    spectralDensity: number;
    silenceRatio: number;
    musicalSalience: number;
    confidence: number;
    taskType: string;
    analysisMethod: string;
    analysisUri: string | null;
    onchainMetadataKey: string | null;
    onchainTaskHash: string | null;
    onchainTxHash: string | null;
    onchainStatus: string;
    onchainError: string | null;
    purchaseValidationCount: number;
    skipValidationCount: number;
    reputationDelta: number;
    createdAt: Date;
    updatedAt: Date;
  }): StemQualityRatingView {
    return {
      id: rating.id,
      stemId: rating.stemId,
      curatorUserId: rating.curatorUserId,
      curatorAgentConfigId: rating.curatorAgentConfigId,
      curatorIdentityRegistry: rating.curatorIdentityRegistry,
      curatorIdentityTokenId: rating.curatorIdentityTokenId,
      score: rating.score,
      metrics: {
        rmsEnergy: rating.rmsEnergy,
        spectralDensity: rating.spectralDensity,
        silenceRatio: rating.silenceRatio,
        musicalSalience: rating.musicalSalience,
      },
      confidence: rating.confidence,
      taskType: rating.taskType,
      analysisMethod: rating.analysisMethod,
      analysisUri: rating.analysisUri,
      onchainMetadataKey: rating.onchainMetadataKey,
      onchainTaskHash: rating.onchainTaskHash,
      onchainTxHash: rating.onchainTxHash,
      onchainStatus: rating.onchainStatus,
      onchainError: rating.onchainError,
      purchaseValidationCount: rating.purchaseValidationCount,
      skipValidationCount: rating.skipValidationCount,
      reputationDelta: rating.reputationDelta,
      createdAt: rating.createdAt.toISOString(),
      updatedAt: rating.updatedAt.toISOString(),
    };
  }
}
