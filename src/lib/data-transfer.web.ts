import { parseImportedAppData } from '@/lib/storage';
import type { AppData } from '@/types/sakai';
import { desktopError, getDesktopApi } from '@/lib/desktop';

export async function exportAppData(data: AppData): Promise<void> {
  const api = getDesktopApi();
  if (api) {
    try { await api.exportData(JSON.stringify(data, null, 2)); return; } catch (cause) { throw desktopError(cause); }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'sakai-client-export.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importAppData(): Promise<AppData> {
  const api = getDesktopApi();
  if (api) {
    try { return parseImportedAppData(await api.importData()); } catch (cause) { throw desktopError(cause); }
  }
  const file = await chooseJsonFile();
  return parseImportedAppData(await file.text());
}

function chooseJsonFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) resolve(file);
      else reject(new Error('No se selecciono ningun archivo.'));
    };
    input.click();
  });
}
