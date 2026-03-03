/**
 * metadataExtractor unit tests — Issue #362
 *
 * Tests the formatDuration utility (pure function).
 * extractMetadata and extractArtworkFromMetadata require browser File/Blob APIs
 * and music-metadata — these would need jsdom env or integration tests.
 */
import { describe, it, expect } from 'vitest';
import { formatDuration } from './metadataExtractor';

describe('formatDuration', () => {
  it('formats whole minutes', () => {
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(120)).toBe('2:00');
  });

  it('formats seconds with zero-padding', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3)).toBe('0:03');
  });

  it('formats mixed minutes and seconds', () => {
    expect(formatDuration(185)).toBe('3:05');
    expect(formatDuration(210)).toBe('3:30');
  });

  it('returns --:-- for null/undefined/NaN', () => {
    expect(formatDuration(null)).toBe('--:--');
    expect(formatDuration(undefined)).toBe('--:--');
    expect(formatDuration(NaN)).toBe('--:--');
  });

  it('returns --:-- for negative values', () => {
    expect(formatDuration(-5)).toBe('--:--');
  });

  it('returns 0:00 for zero', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('handles string input', () => {
    expect(formatDuration('90')).toBe('1:30');
    expect(formatDuration('0')).toBe('0:00');
  });

  it('handles non-numeric string', () => {
    expect(formatDuration('not-a-number')).toBe('--:--');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(90.7)).toBe('1:30');
    expect(formatDuration(59.99)).toBe('0:59');
  });
});
