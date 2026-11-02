/**
 * metadataExtractor unit tests — Issue #362
 *
 * Tests the formatDuration utility (pure function).
 * extractMetadata and extractArtworkFromMetadata require browser File/Blob APIs
 * and music-metadata — these would need jsdom env or integration tests.
 */
import { describe, it, expect } from 'vitest';
import { formatDuration, tagsFromCommon } from './metadataExtractor';

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

describe('tagsFromCommon', () => {
  it('reads track and disc numbers, credits and the label', () => {
    const tags = tagsFromCommon({
      title: 'Uragano',
      artist: 'Furax Barbarossa',
      album: 'Caravelle',
      track: { no: 2, of: 18 },
      disk: { no: 1, of: 2 },
      label: ['Some Label'],
      copyright: '℗ 2022 Some Label',
      isrc: ['FR1234567890'],
      composer: ['A', 'B', 'A'],
      producer: ['P'],
    }, '02 Uragano.wav');
    expect(tags).toMatchObject({
      title: 'Uragano',
      trackNumber: 2,
      discNumber: 1,
      label: 'Some Label',
      copyright: '℗ 2022 Some Label',
      isrc: 'FR1234567890',
      composer: 'A, B',
      producer: 'P',
    });
  });

  it('falls back to the release and original dates for the year', () => {
    expect(tagsFromCommon({ date: '2022-07-08' }, 'x.mp3').year).toBe(2022);
    expect(tagsFromCommon({ releasedate: '2021-01-01' }, 'x.mp3').year).toBe(2021);
    expect(tagsFromCommon({ originalyear: 1999 }, 'x.mp3').year).toBe(1999);
    expect(tagsFromCommon({}, 'x.mp3').year).toBeNull();
  });

  it('names an untagged file after the file and ignores impossible numbers', () => {
    const tags = tagsFromCommon({ track: { no: 0, of: null }, disk: { no: null, of: null } }, '01 Introduzione.wav');
    expect(tags.title).toBe('01 Introduzione');
    expect(tags.trackNumber).toBeNull();
    expect(tags.discNumber).toBeNull();
  });
});
