import { afterEach, expect, mock, test } from 'bun:test';

import { notifyDownloadFinished } from '../src/lib/notifications.web.ts';

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  mock.restore();
});

test('desktop download completion reports outcomes without exposing error details', async () => {
  const notify = mock(async () => {});
  globalThis.window = { sakaiDesktop: {
    apiVersion: 1,
    notificationPermission: async () => true,
    notify,
  } };
  await notifyDownloadFinished({
    downloaded: 3,
    skipped: 2,
    failed: 1,
    timedOut: 1,
    total: 7,
    errors: ['private failure detail', 'timeout detail', 'discovery detail'],
  });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({
    id: '__sakai_downloads__',
    title: 'Descarga finalizada con incidencias',
  });
  expect(notify.mock.calls[0][0].body).toContain('3 descargados');
  expect(notify.mock.calls[0][0].body).toContain('1 incidencias');
  expect(notify.mock.calls[0][0].body).not.toContain('private failure detail');
});

test('desktop download completion remains silent without notification permission', async () => {
  const notify = mock(async () => {});
  globalThis.window = { sakaiDesktop: {
    apiVersion: 1,
    notificationPermission: async () => false,
    notify,
  } };
  await notifyDownloadFinished({ downloaded: 1, skipped: 0, failed: 0, timedOut: 0, total: 1 });
  expect(notify).not.toHaveBeenCalled();
});
