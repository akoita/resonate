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

  // #1778: BullMQ v5+ increments `attemptsMade` only after a job completes or
  // fails, so inside the processor it counts attempts that already failed and
  // the in-flight one is not included. The previous spec asserted
  // `attemptsMade: 3` for a 3-attempt job — a value the runtime never produces
  // — which is why it stayed green while no terminal failure ever refunded.
  // Assert the whole sequence instead, using the values the runtime does
  // produce, so a future change to these counters fails here.
  describe('terminal-failure refund across a 3-attempt job (#1334, #1778)', () => {
    const data = { jobId: 'job-1', userId: 'user-1', durationSeconds: 30 };

    const runAttempt = async (attemptsMade: number) => {
      const generationService = {
        processGenerationJob: jest.fn().mockRejectedValue(new Error('boom')),
        refundFailedGenerationJob: jest.fn().mockResolvedValue(undefined),
      };
      const processor = new GenerationProcessor(generationService as any);

      await expect(
        processor.process({
          id: 'job-1',
          data,
          attemptsMade,
          opts: { attempts: 3 },
        } as any),
      ).rejects.toThrow('boom');

      return generationService;
    };

    it.each([
      ['first attempt', 0],
      ['second attempt', 1],
    ])('does not refund on the %s', async (_label, attemptsMade) => {
      const service = await runAttempt(attemptsMade);
      expect(service.refundFailedGenerationJob).not.toHaveBeenCalled();
    });

    it('refunds on the third and final attempt', async () => {
      const service = await runAttempt(2);
      expect(service.refundFailedGenerationJob).toHaveBeenCalledWith(data);
      expect(service.refundFailedGenerationJob).toHaveBeenCalledTimes(1);
    });
  });

  it('refunds immediately when the job is configured for a single attempt', async () => {
    const data = { jobId: 'job-2', userId: 'user-1', durationSeconds: 30 };
    const generationService = {
      processGenerationJob: jest.fn().mockRejectedValue(new Error('boom')),
      refundFailedGenerationJob: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new GenerationProcessor(generationService as any);

    await expect(
      processor.process({ id: 'job-2', data, attemptsMade: 0, opts: { attempts: 1 } } as any),
    ).rejects.toThrow('boom');

    expect(generationService.refundFailedGenerationJob).toHaveBeenCalledWith(data);
  });

  it('refunds when no attempt limit is configured at all', async () => {
    const data = { jobId: 'job-3', userId: 'user-1', durationSeconds: 30 };
    const generationService = {
      processGenerationJob: jest.fn().mockRejectedValue(new Error('boom')),
      refundFailedGenerationJob: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new GenerationProcessor(generationService as any);

    await expect(
      processor.process({ id: 'job-3', data, attemptsMade: 0 } as any),
    ).rejects.toThrow('boom');

    expect(generationService.refundFailedGenerationJob).toHaveBeenCalledWith(data);
  });
});
