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
});
