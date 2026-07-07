import { GenerationProcessor } from '../modules/generation/generation.processor';

describe('GenerationProcessor', () => {
  it('returns generated track identifiers as the BullMQ job result', async () => {
    const result = { trackId: 'track-1', releaseId: 'release-1' };
    const generationService = {
      processGenerationJob: jest.fn().mockResolvedValue(result),
    };
    const processor = new GenerationProcessor(generationService as any);

    await expect(
      processor.process({
        id: 'job-1',
        data: { jobId: 'job-1', userId: 'user-1', prompt: 'ambient' },
      } as any),
    ).resolves.toEqual(result);

    expect(generationService.processGenerationJob).toHaveBeenCalledWith({
      jobId: 'job-1',
      userId: 'user-1',
      prompt: 'ambient',
    });
  });

  it('refunds credits on the final (terminal) failed attempt (#1334)', async () => {
    const data = { jobId: 'job-1', userId: 'user-1', durationSeconds: 30 };
    const generationService = {
      processGenerationJob: jest.fn().mockRejectedValue(new Error('boom')),
      refundFailedGenerationJob: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new GenerationProcessor(generationService as any);

    await expect(
      processor.process({
        id: 'job-1',
        data,
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow('boom');

    expect(generationService.refundFailedGenerationJob).toHaveBeenCalledWith(data);
  });

  it('does NOT refund on a retryable (non-terminal) failed attempt', async () => {
    const generationService = {
      processGenerationJob: jest.fn().mockRejectedValue(new Error('transient')),
      refundFailedGenerationJob: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new GenerationProcessor(generationService as any);

    await expect(
      processor.process({
        id: 'job-1',
        data: { jobId: 'job-1', userId: 'user-1', durationSeconds: 30 },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as any),
    ).rejects.toThrow('transient');

    expect(generationService.refundFailedGenerationJob).not.toHaveBeenCalled();
  });
});
