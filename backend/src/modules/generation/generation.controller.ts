import { Body, Controller, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { GenerationService } from './generation.service';
import { CreateGenerationDto } from './generation.dto';

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
    const userId = req.user?.id || req.user?.sub;
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
    const userId = req.user?.id || req.user?.sub;
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
    const userId = req.user?.id || req.user?.sub;
    return this.generationService.getAnalytics(userId);
  }

  /**
   * Get the status of a generation job.
   */
  @UseGuards(AuthGuard('jwt'))
  @Get(':jobId/status')
  async status(@Param('jobId') jobId: string) {
    return this.generationService.getStatus(jobId);
  }
}
