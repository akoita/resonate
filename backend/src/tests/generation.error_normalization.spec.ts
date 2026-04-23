import { normalizeGenerationErrorMessage } from '../modules/generation/generation.service';

describe('normalizeGenerationErrorMessage', () => {
  it('maps Google RESOURCE_EXHAUSTED (429) to a friendly rate-limit message', () => {
    const googleError = new Error(
      JSON.stringify({
        error: {
          code: 429,
          message:
            'You exceeded your current quota, please refer to https://ai.google.dev/gemini-api/docs/rate-limits. Retry in 31.685177382s.',
          status: 'RESOURCE_EXHAUSTED',
          details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure' }],
        },
      }),
    );
    expect(normalizeGenerationErrorMessage(googleError)).toBe(
      'Generation is temporarily rate-limited. Please try again in a few minutes.',
    );
  });

  it('strips URLs when a message has a preamble before the JSON body', () => {
    const prefixed = new Error(
      `got status: 429 Too Many Requests. ${JSON.stringify({
        error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' },
      })}`,
    );
    expect(normalizeGenerationErrorMessage(prefixed)).toBe(
      'Generation is temporarily rate-limited. Please try again in a few minutes.',
    );
  });

  it('maps INVALID_ARGUMENT (400) to a rephrase-the-prompt message', () => {
    const googleError = new Error(
      JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad' } }),
    );
    expect(normalizeGenerationErrorMessage(googleError)).toBe(
      'The prompt was rejected by the generation provider. Try rephrasing it.',
    );
  });

  it('returns a generic message for unrecognized Google-shaped errors', () => {
    const googleError = new Error(
      JSON.stringify({ error: { code: 500, status: 'INTERNAL', message: 'boom' } }),
    );
    expect(normalizeGenerationErrorMessage(googleError)).toBe(
      'Generation failed. Please try again.',
    );
  });

  it('passes through non-Google errors unchanged', () => {
    expect(normalizeGenerationErrorMessage(new Error('Rate limit exceeded: maximum 50/hour'))).toBe(
      'Rate limit exceeded: maximum 50/hour',
    );
  });

  it('accepts plain strings', () => {
    expect(normalizeGenerationErrorMessage('something went wrong')).toBe('something went wrong');
  });

  it('handles null/undefined with a safe default', () => {
    expect(normalizeGenerationErrorMessage(null)).toBe('Generation failed. Please try again.');
    expect(normalizeGenerationErrorMessage(undefined)).toBe('Generation failed. Please try again.');
  });
});
