import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { parseImportedAppData } from '@/lib/storage';
import type { AppData } from '@/types/sakai';

export async function exportAppData(data: AppData): Promise<void> {
  const file = new File(Paths.cache, 'sakai-client-export.json');
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(data, null, 2));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Exportar datos' });
}

export async function importAppData(): Promise<AppData> {
  const result = await File.pickFileAsync({ mimeTypes: ['application/json'] });
  if (result.canceled) throw new Error('Importacion cancelada.');
  return parseImportedAppData(await result.result.text());
}
