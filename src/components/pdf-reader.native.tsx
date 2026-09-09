import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { usePaletteColors, useResolvedColorScheme } from '@/hooks/use-palette';
import { isWebUrl } from '@/lib/announcements';

export default function PdfReader({ uri, documentId, onReady }: {
  uri?: string;
  documentId: string;
  readData: () => Promise<string>;
  onReady: (pages: number) => Promise<void>;
  dom?: unknown;
}) {
  const dark = useResolvedColorScheme() === 'dark';
  const colors = usePaletteColors();
  const [source, setSource] = useState<string>();
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let active = true;
    let temporary: File | undefined;
    void (async () => {
      if (!uri || !/^(file|content):\/\//.test(uri)) throw new Error('El visor solo admite documentos locales.');
      const file = new File(uri);
      if (!file.exists) throw new Error('El archivo no esta disponible. Vuelve a descargarlo.');
      if (uri.startsWith('content://')) {
        temporary = new File(Paths.cache, `sakai-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        await file.copy(temporary);
      }
      if (active) setSource(temporary?.uri ?? file.uri);
      else if (temporary?.exists) temporary.delete();
    })().catch((cause: unknown) => {
      if (temporary?.exists) temporary.delete();
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el PDF.');
    });
    return () => { active = false; if (temporary?.exists) temporary.delete(); };
  }, [uri, documentId]);

  if (error) return <Text accessibilityRole="alert" className="p-4 text-base text-ember">{error}</Text>;
  if (!source) return <ActivityIndicator style={{ margin: 24 }} color={colors.pine} />;
  return <View style={{ flex: 1, backgroundColor: dark ? '#18181B' : '#EEEEEA' }}>
    <Pdf
      source={{ uri: source, cache: false }}
      style={{ flex: 1, backgroundColor: dark ? '#18181B' : '#EEEEEA' }}
      trustAllCerts={false}
      fitPolicy={0}
      minScale={0.75}
      maxScale={4}
      spacing={8}
      enableDoubleTapZoom
      enableTextSelection
      onLoadComplete={(count) => { setPages(count); void onReady(count); }}
      onPageChanged={(number, count) => { setPage(number); setPages(count); }}
      onError={() => setError('No se pudo leer este PDF. Comprueba si esta protegido o vuelve a descargarlo.')}
      onPressLink={(url) => { if (isWebUrl(url)) router.push(url as `https://${string}`); }}
    />
    {pages ? <View pointerEvents="none" style={{ position: 'absolute', right: 12, bottom: 12, backgroundColor: '#00000099', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 12 }}>{page} / {pages}</Text>
    </View> : null}
  </View>;
}
