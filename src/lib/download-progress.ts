import type { SyncProgress } from '@/types/sakai';

export function syncProgressFraction(progress?: SyncProgress): number {
  if (!progress?.total) return 0;
  if (progress.current >= progress.total) return 1;
  if (progress.totalBytes && progress.completedBytes !== undefined) {
    return Math.max(0, Math.min(1, (progress.completedBytes + (progress.fileBytesReceived ?? 0)) / progress.totalBytes));
  }
  return Math.max(0, Math.min(1, (progress.current + (progress.fileProgress ?? 0)) / progress.total));
}

export function fileProgressLabel(progress?: SyncProgress): string | undefined {
  if (progress?.fileBytesReceived === undefined) return undefined;
  return progress.fileBytesTotal
    ? `${formatBytes(progress.fileBytesReceived)} / ${formatBytes(progress.fileBytesTotal)}`
    : `${formatBytes(progress.fileBytesReceived)} recibidos`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
