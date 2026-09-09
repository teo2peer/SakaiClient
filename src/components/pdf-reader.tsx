'use dom';

import type { DOMProps } from 'expo/dom';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import * as library from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as worker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import assets from '@/lib/pdf-assets.generated';

(globalThis as typeof globalThis & { pdfjsWorker: unknown }).pdfjsWorker = worker;

class LocalBinaryDataFactory {
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    const encoded = assets[filename] ?? assets[`${filename}.bcmap`];
    if (!encoded) throw new Error('No se encontro un recurso local del motor PDF.');
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  }
}

export default function PdfReader({ documentId, readData, onReady, dom: _dom }: {
  uri?: string;
  documentId: string;
  readData: () => Promise<string>;
  onReady: (pages: number) => Promise<void>;
  dom?: DOMProps;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewportContainer = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(366);
  const getData = useEffectEvent(readData);
  const reportReady = useEffectEvent(onReady);

  useEffect(() => {
    const element = viewportContainer.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    void (async () => {
      const encoded = await getData();
      if (!active) return;
      const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      task = library.getDocument({ data, enableXfa: false, useWasm: true, useWorkerFetch: false, useSystemFonts: true, BinaryDataFactory: LocalBinaryDataFactory, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64_000_000 });
      const loaded = await task.promise;
      if (!active) return;
      setPdf(loaded);
    })().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el PDF.');
    });
    return () => { active = false; void task?.destroy().catch(() => undefined); };
  }, [documentId]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let render: RenderTask | undefined;
    void pdf.getPage(page).then(async (documentPage) => {
      if (!active || !canvas.current) return;
      const base = documentPage.getViewport({ scale: 1 });
      const width = Math.max(200, Math.min(availableWidth, 1000));
      const scale = Math.min(2, window.devicePixelRatio || 1) * width / base.width * zoom;
      let viewport = documentPage.getViewport({ scale });
      const limit = Math.min(1, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      if (limit < 1) viewport = documentPage.getViewport({ scale: scale * limit });
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      canvas.current.style.width = `${width * zoom}px`;
      canvas.current.style.height = `${width * zoom * base.height / base.width}px`;
      render = documentPage.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (active && page === 1) await reportReady(pdf.numPages);
      documentPage.cleanup();
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo mostrar la pagina.');
    });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, zoom, availableWidth]);

  return <div style={{ fontFamily: 'system-ui', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#F1F1ED', color: '#18221D' }}>
    <style>{'body{margin:0}button{min-height:44px;min-width:44px;border:1px solid #CCD5CE;border-radius:8px;background:white;color:#1F5B45;font:600 14px system-ui;padding:0 12px}button:disabled{opacity:.4}button:focus-visible{outline:3px solid #1F5B45}'}</style>
    <div role="toolbar" aria-label="Controles del PDF" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 8, background: '#FAFAF7' }}>
      <button disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)} aria-label="Pagina anterior">Anterior</button>
      <span aria-live="polite">{page} / {pdf?.numPages ?? '-'}</span>
      <button disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(page + 1)} aria-label="Pagina siguiente">Siguiente</button>
      <button disabled={zoom <= 0.75} onClick={() => setZoom(Math.max(0.75, zoom - 0.25))} aria-label="Reducir zoom">-</button>
      <button disabled={zoom >= 2} onClick={() => setZoom(Math.min(2, zoom + 0.25))} aria-label="Aumentar zoom">+</button>
    </div>
    {error ? <p role="alert" style={{ padding: 16 }}>{error}</p> : !pdf ? <p role="status" style={{ padding: 16 }}>Abriendo PDF local...</p> : null}
    <div ref={viewportContainer} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}><canvas key={`${page}:${zoom}:${availableWidth}`} ref={canvas} aria-label={`Pagina ${page} del documento PDF`} /></div>
  </div>;
}
