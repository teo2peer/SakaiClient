import { getDesktopApi } from '@/lib/desktop';

export async function setBackgroundSyncEnabled(enabled: boolean): Promise<boolean> {
  return await getDesktopApi()?.setBackgroundRefresh(enabled) ?? false;
}
