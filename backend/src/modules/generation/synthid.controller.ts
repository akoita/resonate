import { Controller, Post, UploadedFile, UseInterceptors, Param, Logger, BadRequestException, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { SynthIdService } from './synthid.service';

/**
 * SynthID Verification Controller
 * 
 * Provides REST endpoints for verifying SynthID watermarks
 * in audio content (uploaded files or existing stems).
 */
/** Uploads are held in memory for the check, so they are capped. */
export const SYNTHID_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

@Controller('generation/synthid')
export class SynthIdController {
  private readonly logger = new Logger(SynthIdController.name);

  constructor(private readonly synthIdService: SynthIdService) {}

  /**
   * Verify an uploaded audio file for SynthID watermark.
   * POST /api/generation/synthid/verify
   */
  @Post('verify')
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: SYNTHID_UPLOAD_MAX_BYTES } }))
  async verifyUpload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No audio file provided');
    }

    if (!this.synthIdService.isAvailable()) {
      return {
        available: false,
        message: 'SynthID verification is not configured',
        result: null,
      };
    }

    this.logger.log(`Verifying SynthID for uploaded file: ${file.originalname} (${file.size} bytes)`);

    const result = await this.synthIdService.verify(file.buffer);

    return {
      available: true,
      filename: file.originalname,
      size: file.size,
      result: {
        checked: result.checked,
        isAiGenerated: result.isAiGenerated,
        confidence: result.confidence,
        provider: result.provider,
      },
    };
  }

  /**
   * Verify an existing stem by ID.
   * POST /api/generation/synthid/verify/:stemId
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('verify/:stemId')
  async verifyStem(@Param('stemId') stemId: string) {
    if (!this.synthIdService.isAvailable()) {
      return {
        available: false,
        message: 'SynthID verification is not configured',
        result: null,
      };
    }

    this.logger.log(`Verifying SynthID for stem: ${stemId}`);

    const result = await this.synthIdService.verifyStemById(stemId);

    return {
      available: true,
      stemId,
      result: {
        checked: result.checked,
        isAiGenerated: result.isAiGenerated,
        confidence: result.confidence,
        provider: result.provider,
      },
    };
  }
}
