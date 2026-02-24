import { IsString, IsOptional, IsNumber, IsNotEmpty, MaxLength, Min, Max } from 'class-validator';

export class CreateGenerationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  prompt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  negativePrompt?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(2147483647)
  seed?: number;

  @IsString()
  @IsNotEmpty()
  artistId!: string;
}

export interface GenerationStatusResponse {
  jobId: string;
  status: 'queued' | 'generating' | 'storing' | 'finalizing' | 'completed' | 'failed';
  trackId?: string;
  releaseId?: string;
  error?: string;
  createdAt?: string;
}

export interface GenerationMetadata {
  jobId?: string;
  provider: 'lyria-002';
  prompt: string;
  negativePrompt?: string;
  seed: number;
  generatedAt: string;
  synthIdPresent: boolean;
  durationSeconds: 30;
  sampleRate: 48000;
  cost: number;
}

/**
 * All stem types recognized by the platform.
 * Demucs produces: vocals, drums, bass, other.
 * Extended set includes piano and guitar (6-stem htdemucs_6s model).
 */
export const ALL_STEM_TYPES = ['vocals', 'drums', 'bass', 'piano', 'guitar', 'other'] as const;
export type StemType = typeof ALL_STEM_TYPES[number];

export class CreateComplementaryDto {
  @IsString()
  @IsNotEmpty()
  trackId!: string;

  @IsString()
  @IsNotEmpty()
  stemType!: string;
}

export class PublishGenerationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  artist!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  genre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsString()
  releaseDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  featuredArtists?: string;
}

export interface StemAnalysisResult {
  trackId: string;
  trackTitle: string;
  releaseGenre?: string;
  presentTypes: string[];
  missingTypes: string[];
  suggestedPrompt: string;
  negativePrompt: string;
}
