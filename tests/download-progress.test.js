import { expect, test } from 'bun:test';

import { fileProgressLabel, syncProgressFraction } from '../src/lib/download-progress.ts';

test('uses known bytes for aggregate progress and completes after processed failures', () => {
  const progress = {
    current: 1, total: 2, downloaded: 1, skipped: 0, failed: 0, timedOut: 0,
    completedBytes: 1_000, totalBytes: 1_100, fileBytesReceived: 50, fileBytesTotal: 100, fileProgress: 0.5,
  };
  expect(syncProgressFraction(progress)).toBeCloseTo(1050 / 1100);
  expect(fileProgressLabel(progress)).toBe('50 B / 100 B');
  expect(syncProgressFraction({ ...progress, current: 2, fileBytesReceived: undefined })).toBe(1);
});

test('falls back to file ratios when any total byte size is unknown', () => {
  expect(syncProgressFraction({
    current: 1, total: 4, downloaded: 1, skipped: 0, failed: 0, timedOut: 0, fileProgress: 0.5,
  })).toBe(0.375);
});
