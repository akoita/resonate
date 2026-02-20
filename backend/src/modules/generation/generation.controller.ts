import { Body, Controller, Get, Param, Post, Patch, Query, UseGuards, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { GenerationService } from './generation.service';
import { CreateGenerationDto, CreateComplementaryDto, PublishGenerationDto } from './generation.dto';

@Controller('generation')
export class GenerationController {
  constructor(private readonly generationService: GenerationService) {}

  /**
   * Create a new AI music generation job.
   * Accepts a text prompt and returns a job ID for tracking.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  async create(
    @Body() dto: CreateGenerationDto,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.generationService.createGeneration(dto, userId);
  }

  /**
   * List the authenticated user's AI-generated tracks.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('mine')
  async listMine(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.generationService.listUserGenerations(
      userId,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  /**
   * Get generation analytics and rate limit status for the authenticated user.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('analytics')
  async analytics(@Req() req: any) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.generationService.getAnalytics(userId);
  }

  // ---------------------------------------------------------------------------
  // Stem-Aware Generation — #336 subset
  // ---------------------------------------------------------------------------

  /**
   * Analyze a track's existing stems to determine which types are missing.
   * Returns: presentTypes, missingTypes, suggestedPrompt, negativePrompt.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('analyze/:trackId')
  async analyzeStems(@Param('trackId') trackId: string) {
    return this.generationService.analyzeTrackStems(trackId);
  }

  /**
   * Generate a complementary stem for a track.
   * Auto-derives prompt + negative prompt from existing stems.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('complementary')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  async generateComplementary(
    @Body() dto: CreateComplementaryDto,
    @Req() req: any,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.generationService.generateComplementaryStem(
      dto.trackId,
      dto.stemType,
      userId,
    );
  }

  /**
   * Get the status of a generation job.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get(':jobId/status')
  async status(@Param('jobId') jobId: string) {
    return this.generationService.getStatus(jobId);
  }

  /**
   * Update the release and track metadata for an AI-generated stem.
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch(':trackId/publish')
  @UseInterceptors(FileInterceptor('artworkBlob'))
  async publish(
    @Param('trackId') trackId: string,
    @Body() dto: PublishGenerationDto,
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = req.user?.userId || req.user?.id || req.user?.sub;
    return this.generationService.publishGeneration(trackId, dto, userId, file);
  }

  /**
   * Generate cover artwork from a text prompt using Gemini image generation.
   * Returns base64-encoded image data.
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('artwork')
  @Throttle({ default: { limit: 5, ttl: 60 } })
  async generateArtwork(
    @Body() body: { prompt: string },
  ) {
    if (!body.prompt?.trim()) {
      throw new Error('Prompt is required');
    }
    return this.generationService.generateArtwork(body.prompt.trim());
  }
}
