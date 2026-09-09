import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { restoreAuthenticatedClient } from '@/lib/auth';
import { BACKGROUND_SYNC_TASK } from '@/lib/constants';
import { notifyNewAnnouncements } from '@/lib/notifications';
import { loadAppData } from '@/lib/storage';

let backgroundRevision = 0;

if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      const revision = backgroundRevision;
      const previous = await loadAppData();
      if (!previous.settings.notifications) return BackgroundTask.BackgroundTaskResult.Success;
      const client = await restoreAuthenticatedClient(() => revision === backgroundRevision);
      if (!client) return BackgroundTask.BackgroundTaskResult.Failed;

      const announcements = await client.getAnnouncements();
      const knownAnnouncements = new Set(previous.announcements.map((item) => item.id));
      const newAnnouncements = announcements.filter((item) => !knownAnnouncements.has(item.id));
      const latest = await loadAppData();
      if (revision !== backgroundRevision || !latest.settings.notifications) return BackgroundTask.BackgroundTaskResult.Success;
      if (previous.lastRefreshAt && newAnnouncements.length > 0) {
        await notifyNewAnnouncements(newAnnouncements, () => revision === backgroundRevision);
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function setBackgroundSyncEnabled(enabled: boolean): Promise<boolean> {
  backgroundRevision += 1;
  if (!(await TaskManager.isAvailableAsync())) return false;
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);

  if (enabled && !registered) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 60 });
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
  return enabled;
}
