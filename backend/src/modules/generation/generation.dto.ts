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
