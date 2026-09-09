import type { AppData } from '@/types/sakai';

export async function exportAppData(_data: AppData): Promise<void> {
  throw new Error('La exportacion no esta disponible en esta plataforma.');
}

export async function importAppData(): Promise<AppData> {
  throw new Error('La importacion no esta disponible en esta plataforma.');
}
